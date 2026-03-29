import 'dotenv/config';
import { runResearcher } from '../src/researcher/index.js';
import { collectAllAssets } from '../src/asset-collector/index.js';
import { writeAllScripts } from '../src/scriptwriter/index.js';
import { produceAllVideos } from '../src/video-producer/index.js';
import { buildPostingPackage, getDailyBriefing } from '../src/content-manager/index.js';
import { analyzePerformance, generateSignals } from '../src/analyst/index.js';
import { readProductQueue, readErrors, writeLastRun, trimErrors } from '../src/shared/state.js';
import { resolve } from 'path';
import { getProjectRoot, validateEnvironment } from '../src/shared/config.js';
import { acquireLock, releaseLock, getLockInfo } from '../src/shared/lock.js';

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

  try {
    // Step 1: Research
    console.log('--- Step 1: Research ---');
    const products = await runResearcher();
    productsFound = products.length;

    if (products.length === 0) {
      console.log('No products found — pipeline stopping');
      return;
    }

    // Step 2: Collect assets
    console.log('\n--- Step 2: Asset Collection ---');
    await collectAllAssets();

    // Step 3: Generate scripts
    console.log('\n--- Step 3: Script Generation ---');
    await writeAllScripts();

    // Step 4: Produce videos
    console.log('\n--- Step 4: Video Production ---');
    videosProduced = await produceAllVideos();

    // Step 5: Package for posting
    console.log('\n--- Step 5: Content Packaging ---');
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

    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound,
      videosProduced,
      errors,
    });

    releaseLock();
  }
}

main();
