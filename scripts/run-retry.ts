import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot, validateEnvironment } from '../src/shared/config.js';
import {
  readProductQueue,
  writeProductQueue,
  getFailedProducts,
  appendError,
} from '../src/shared/state.js';
import { acquireLock, releaseLock, getLockInfo } from '../src/shared/lock.js';
import { collectAssets } from '../src/asset-collector/index.js';
import { writeScript } from '../src/scriptwriter/index.js';
import { produceVideo } from '../src/video-producer/index.js';
import type { QueuedProduct, AssetManifest, ProductScript, ProductStatus, FailRecord } from '../src/shared/types.js';

const DEFAULT_MAX_RETRIES = 3;

function loadManifest(productId: string): AssetManifest | null {
  const path = resolve(getProjectRoot(), 'output', 'assets', productId, 'meta.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as AssetManifest;
}

function loadScript(productId: string): ProductScript | null {
  const path = resolve(getProjectRoot(), 'output', 'assets', productId, 'script.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductScript;
}

/** Map failed status → the input status to reset to before retrying */
const RETRY_INPUT_STATUS: Record<string, ProductStatus> = {
  assets_failed: 'queued',
  script_failed: 'assets_ready',
  video_failed: 'script_ready',
};

function parseArgs(): {
  statusFilter: string | null;
  productFilter: string | null;
  maxRetries: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let statusFilter: string | null = null;
  let productFilter: string | null = null;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--status' && args[i + 1]) {
      statusFilter = args[++i]!;
    } else if (arg === '--product' && args[i + 1]) {
      productFilter = args[++i]!;
    } else if (arg === '--max-retries' && args[i + 1]) {
      maxRetries = parseInt(args[++i]!, 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Retry failed products in the pipeline.\n');
      console.log('Usage:');
      console.log('  npm run retry                          # retry all failed products');
      console.log('  npm run retry -- --status assets_failed # retry only asset failures');
      console.log('  npm run retry -- --product <id>         # retry a specific product');
      console.log('  npm run retry -- --dry-run              # show what would be retried');
      console.log('  npm run retry -- --max-retries 5        # override max (default: 3)');
      process.exit(0);
    }
  }

  return { statusFilter, productFilter, maxRetries, dryRun };
}

async function retryProduct(product: QueuedProduct, maxRetries: number): Promise<boolean> {
  const failedStatus = product.status;
  const inputStatus = RETRY_INPUT_STATUS[failedStatus];
  if (!inputStatus) {
    console.error(`[retry] Unknown failed status: ${failedStatus}`);
    return false;
  }

  const attempt = (product.retryCount ?? 0) + 1;
  console.log(`\n[retry] Retrying ${product.productName.slice(0, 50)} (attempt ${attempt}/${maxRetries})`);
  console.log(`[retry] ${failedStatus} → reset to ${inputStatus}`);

  // Reset status and persist before calling step function
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.id === product.id);
  if (idx === -1) {
    console.error(`[retry] Product ${product.id} not found in queue`);
    return false;
  }
  queue[idx]!.status = inputStatus;
  queue[idx]!.retryCount = attempt;
  queue[idx]!.lastRetryAt = new Date().toISOString();
  writeProductQueue(queue);

  let success = false;

  try {
    if (failedStatus === 'assets_failed') {
      const manifest = await collectAssets(product);
      success = manifest !== null;
    } else if (failedStatus === 'script_failed') {
      const manifest = loadManifest(product.tiktokShopId);
      if (!manifest) {
        console.error(`[retry] No manifest on disk for ${product.tiktokShopId} — cannot retry script`);
        success = false;
      } else {
        const script = await writeScript(product, manifest);
        success = script !== null;
      }
    } else if (failedStatus === 'video_failed') {
      const manifest = loadManifest(product.tiktokShopId);
      const script = loadScript(product.tiktokShopId);
      if (!manifest || !script) {
        const missing = !manifest ? 'manifest' : 'script';
        console.error(`[retry] No ${missing} on disk for ${product.tiktokShopId} — cannot retry video`);
        success = false;
      } else {
        const result = await produceVideo(product, script, manifest);
        success = result !== null;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[retry] Error: ${message}`);
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'retry',
      message: `Retry attempt ${attempt} failed: ${message}`,
      productId: product.tiktokShopId,
    });
  }

  // Update status based on result
  const currentQueue = readProductQueue();
  const currentIdx = currentQueue.findIndex((p) => p.id === product.id);
  if (currentIdx !== -1) {
    const p = currentQueue[currentIdx]!;

    if (success) {
      // Step function already set the next status via its own queue write,
      // but ensure retryCount is preserved
      const freshQueue = readProductQueue();
      const freshIdx = freshQueue.findIndex((q) => q.id === product.id);
      if (freshIdx !== -1) {
        freshQueue[freshIdx]!.retryCount = attempt;
        freshQueue[freshIdx]!.lastRetryAt = new Date().toISOString();
        writeProductQueue(freshQueue);
      }
      console.log(`[retry] ✓ Success — ${product.productName.slice(0, 50)}`);
    } else {
      // Put it back to failed status
      p.status = failedStatus;
      p.retryCount = attempt;
      p.lastRetryAt = new Date().toISOString();

      // Append to fail history
      const failRecord: FailRecord = {
        status: failedStatus,
        error: 'Retry failed',
        timestamp: new Date().toISOString(),
        attempt,
      };
      p.failHistory = [...(p.failHistory ?? []), failRecord];

      // Dead-letter if max retries reached
      if (attempt >= maxRetries) {
        p.status = 'dead_letter';
        console.log(`[retry] ✗ Dead-lettered after ${maxRetries} attempts — ${product.productName.slice(0, 50)}`);
      } else {
        console.log(`[retry] ✗ Failed (${attempt}/${maxRetries}) — ${product.productName.slice(0, 50)}`);
      }

      writeProductQueue(currentQueue);
    }
  }

  return success;
}

async function main(): Promise<void> {
  const { statusFilter, productFilter, maxRetries, dryRun } = parseArgs();

  console.log('\n=== Health is Wealth — Retry Failed Products ===\n');

  validateEnvironment();

  if (!acquireLock('retry')) {
    const info = getLockInfo();
    console.error(`Pipeline is locked by process ${info?.pid} (${info?.label}) since ${info?.since}`);
    console.error('Wait for it to finish or remove state/.lock if the process is dead.');
    process.exit(1);
  }

  try {
    let candidates = getFailedProducts(maxRetries);

    if (statusFilter) {
      candidates = candidates.filter((p) => p.status === statusFilter);
    }
    if (productFilter) {
      candidates = candidates.filter(
        (p) => p.tiktokShopId === productFilter || p.id === productFilter,
      );
    }

    if (candidates.length === 0) {
      console.log('No failed products to retry.');

      // Show dead-lettered products if any
      const queue = readProductQueue();
      const deadLetters = queue.filter((p) => p.status === 'dead_letter');
      if (deadLetters.length > 0) {
        console.log(`\n${deadLetters.length} dead-lettered product(s):`);
        for (const p of deadLetters) {
          console.log(`  ${p.tiktokShopId}  ${p.retryCount ?? 0} retries  ${p.productName.slice(0, 50)}`);
        }
      }
      return;
    }

    console.log(`Found ${candidates.length} product(s) to retry:\n`);
    for (const p of candidates) {
      const attempt = (p.retryCount ?? 0) + 1;
      console.log(`  ${p.tiktokShopId}  [${p.status}]  attempt ${attempt}/${maxRetries}  ${p.productName.slice(0, 40)}`);
    }

    if (dryRun) {
      console.log('\n--dry-run: no action taken.');
      return;
    }

    console.log('');

    let succeeded = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const product of candidates) {
      const ok = await retryProduct(product, maxRetries);
      if (ok) {
        succeeded++;
      } else {
        const freshQueue = readProductQueue();
        const freshProduct = freshQueue.find((p) => p.id === product.id);
        if (freshProduct?.status === 'dead_letter') {
          deadLettered++;
        } else {
          failed++;
        }
      }
    }

    console.log(`\n--- Retry Summary ---`);
    console.log(`Succeeded:    ${succeeded}`);
    console.log(`Failed:       ${failed}`);
    console.log(`Dead-lettered: ${deadLettered}`);
  } finally {
    releaseLock();
  }
}

main();
