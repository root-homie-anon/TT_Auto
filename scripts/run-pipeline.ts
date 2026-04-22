import 'dotenv/config';
import { runResearcher } from '../src/researcher/index.js';
import { collectAllAssets } from '../src/asset-collector/index.js';
import { writeAllScripts } from '../src/scriptwriter/index.js';
import { produceAllVideos } from '../src/video-producer/index.js';
import { buildPostingPackage, getDailyBriefing } from '../src/content-manager/index.js';
import { analyzePerformance, generateSignals } from '../src/analyst/index.js';
import {
  readProductQueue,
  readErrors,
  writeLastRun,
  trimErrors,
  getRetryableProducts,
  updateProduct,
  appendError,
} from '../src/shared/state.js';
import type { PipelineStage } from '../src/shared/types.js';
import { resolve } from 'path';
import { getProjectRoot, validateEnvironment } from '../src/shared/config.js';
import { acquireLock, releaseLock, getLockInfo } from '../src/shared/lock.js';
import { FFMPEG_HALT_SUBSTRING, DEFAULT_STAGE_POLICIES } from '../src/shared/retry-policy.js';

function printSummary(stats: {
  elapsed: string;
  productsFound: number;
  assetsReady: number;
  assetsFailed: number;
  scriptsReady: number;
  scriptsFailed: number;
  videosProduced: number;
  videosFailed: number;
  packaged: number;
  errors: string[];
}): void {
  const line = '─'.repeat(44);
  console.log(`\n${line}`);
  console.log('  PIPELINE RUN SUMMARY');
  console.log(line);
  console.log(`  Duration:         ${stats.elapsed}s`);
  console.log(`  Products found:   ${stats.productsFound}`);
  console.log(`  Assets collected: ${stats.assetsReady} ok / ${stats.assetsFailed} failed`);
  console.log(`  Scripts written:  ${stats.scriptsReady} ok / ${stats.scriptsFailed} failed`);
  console.log(`  Videos produced:  ${stats.videosProduced} ok / ${stats.videosFailed} failed`);
  console.log(`  Packages built:   ${stats.packaged}`);
  if (stats.errors.length > 0) {
    console.log(`  Errors:           ${stats.errors.length}`);
    for (const err of stats.errors) {
      console.log(`    - ${err}`);
    }
  } else {
    console.log('  Errors:           none');
  }
  console.log(line);
}

async function main(): Promise<void> {
  console.log('\n=== Health is Wealth — Full Pipeline ===\n');

  validateEnvironment();

  if (!acquireLock('pipeline')) {
    const info = getLockInfo();
    console.error(`Pipeline is locked by process ${info?.pid} (${info?.label}) since ${info?.since}`);
    process.exit(1);
  }

  // Trim old errors at start of each run
  trimErrors();

  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0;
  let videosProduced = 0;
  let packaged = 0;

  // Helper to write a per-stage heartbeat into last-run.json
  function writeHeartbeat(stage: PipelineStage): void {
    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound,
      videosProduced,
      errors: [...errors],
      currentStage: stage,
      stageStartedAt: new Date().toISOString(),
    });
  }

  try {
    // Retry sweep — reset eligible failed products before research begins
    console.log('--- Retry Sweep ---');
    const sweepNow = new Date();
    const retryable = getRetryableProducts(sweepNow);

    if (retryable.length === 0) {
      console.log('[retry-sweep] No products eligible for retry');
    } else {
      // Check for ffmpeg stage-wide halt: if any video_failed product's latest FailRecord
      // contains the ffmpeg-missing signature, log and skip all video_failed retries.
      const ffmpegHalt = retryable.some((p) => {
        if (p.status !== 'video_failed') return false;
        const latestVideoFail = [...(p.failHistory ?? [])].reverse().find((r) => r.status === 'video_failed');
        return latestVideoFail?.error.includes(FFMPEG_HALT_SUBSTRING) ?? false;
      });

      if (ffmpegHalt) {
        console.error('[retry-sweep] ffmpeg not installed or not in PATH — skipping all video_failed retries. Fix ffmpeg installation before re-running.');
        appendError({
          timestamp: sweepNow.toISOString(),
          agent: 'retry-sweep',
          level: 'error',
          message: 'ffmpeg not installed or not in PATH — video_failed retries skipped for this run',
        });
      }

      for (const product of retryable) {
        // Skip video_failed products when ffmpeg halt is active
        if (ffmpegHalt && product.status === 'video_failed') continue;

        const fromState = product.status as keyof typeof DEFAULT_STAGE_POLICIES;
        const policy = DEFAULT_STAGE_POLICIES[fromState];
        const toState = policy.retryableTo;
        const attempt = (product.retryCount ?? 0) + 1;

        console.log(`[retry-sweep] ${product.id} (${product.productName.slice(0, 40)}) ${fromState} → ${toState} (attempt ${attempt})`);

        updateProduct(product.id, {
          status: toState,
          retryCount: attempt,
          lastRetryAt: sweepNow.toISOString(),
        });

        appendError({
          timestamp: sweepNow.toISOString(),
          agent: 'retry-sweep',
          level: 'info',
          message: `Retry sweep: reset ${fromState} → ${toState}`,
          productId: product.id,
          details: JSON.stringify({ fromState, toState, attempt }),
        });
      }

      console.log(`[retry-sweep] Reset ${retryable.filter((p) => !(ffmpegHalt && p.status === 'video_failed')).length} product(s) for retry`);
    }

    // Step 1: Research
    console.log('--- Step 1: Research ---');
    writeHeartbeat('research');
    const products = await runResearcher();
    productsFound = products.length;

    if (products.length === 0) {
      console.log('No products found — pipeline stopping');
      return;
    }

    // Step 2: Collect assets
    console.log('\n--- Step 2: Asset Collection ---');
    writeHeartbeat('assets');
    await collectAllAssets();

    // Step 3: Generate scripts
    console.log('\n--- Step 3: Script Generation ---');
    writeHeartbeat('script');
    await writeAllScripts();

    // Step 4: Produce videos
    console.log('\n--- Step 4: Video Production ---');
    writeHeartbeat('video');
    videosProduced = await produceAllVideos();

    // Step 5: Package for posting
    console.log('\n--- Step 5: Content Packaging ---');
    writeHeartbeat('package');
    const queue = readProductQueue();
    const videoReady = queue.filter((p) => p.status === 'video_ready');
    const today = new Date().toISOString().split('T')[0]!;
    for (const product of videoReady) {
      const videoPath = resolve(getProjectRoot(), 'output', today, `${product.tiktokShopId}-final.mp4`);
      const result = buildPostingPackage(product, videoPath);
      if (result) {
        packaged++;
      } else {
        console.log(`[pipeline] Packaging skipped for ${product.productName.slice(0, 50)} (limit reached or video missing)`);
        break;
      }
    }

    // Step 6: Update analyst signals + performance analysis
    console.log('\n--- Step 6: Analyst ---');
    writeHeartbeat('analyst');
    generateSignals();
    analyzePerformance();

    // Briefing
    console.log('\n' + getDailyBriefing());

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nPipeline error: ${message}`);
    errors.push(message);
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Count statuses from the queue for the summary
    const finalQueue = readProductQueue();
    const assetsReady = finalQueue.filter((p) => p.status === 'assets_ready' || p.status === 'script_ready' || p.status === 'video_ready' || p.status === 'post_ready').length;
    const assetsFailed = finalQueue.filter((p) => p.status === 'assets_failed').length;
    const scriptsReady = finalQueue.filter((p) => p.status === 'script_ready' || p.status === 'video_ready' || p.status === 'post_ready').length;
    const scriptsFailed = finalQueue.filter((p) => p.status === 'script_failed').length;
    const videosFailed = finalQueue.filter((p) => p.status === 'video_failed').length;

    // Include any errors logged by agents during this run
    const recentErrors = readErrors().filter((e) => {
      const errTime = new Date(e.timestamp).getTime();
      return errTime >= startTime;
    });
    for (const e of recentErrors) {
      if (!errors.includes(e.message)) {
        errors.push(`[${e.agent}] ${e.message}${e.productId ? ` (${e.productId})` : ''}`);
      }
    }

    printSummary({
      elapsed,
      productsFound,
      assetsReady,
      assetsFailed,
      scriptsReady,
      scriptsFailed,
      videosProduced,
      videosFailed,
      packaged,
      errors,
    });

    const terminalStage: PipelineStage = errors.length > 0 ? 'failed' : 'done';
    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound,
      videosProduced,
      errors,
      currentStage: terminalStage,
      stageStartedAt: new Date().toISOString(),
    });

    releaseLock();
  }
}

main();
