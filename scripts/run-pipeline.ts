import 'dotenv/config';
import { runResearcher } from '../src/researcher/index.js';
import { collectAllAssets } from '../src/asset-collector/index.js';
import { writeAllScripts } from '../src/scriptwriter/index.js';
import { produceAllVideos } from '../src/video-producer/index.js';
import { buildPostingPackage, getDailyBriefing } from '../src/content-manager/index.js';
import { generateSignals } from '../src/analyst/index.js';
import { readProductQueue, writeLastRun } from '../src/shared/state.js';
import { resolve } from 'path';
import { getProjectRoot } from '../src/shared/config.js';

async function main(): Promise<void> {
  console.log('\n=== Health is Wealth — Full Pipeline ===\n');

  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0;
  let videosProduced = 0;

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
    let packaged = 0;
    for (const product of videoReady) {
      const videoPath = resolve(getProjectRoot(), 'output', today, `${product.tiktokShopId}-final.mp4`);
      const result = buildPostingPackage(product, videoPath);
      if (result) {
        packaged++;
      } else {
        console.log(`[pipeline] Packaging skipped for ${product.productName.slice(0, 50)} (limit reached or video missing)`);
        break; // If limit reached, no point trying more
      }
    }
    console.log(`[pipeline] Packaged ${packaged}/${videoReady.length} videos`);

    // Step 6: Update analyst signals
    console.log('\n--- Step 6: Analyst Signals ---');
    generateSignals();

    // Briefing
    console.log('\n' + getDailyBriefing());

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nPipeline error: ${message}`);
    errors.push(message);
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nPipeline completed in ${elapsed}s`);

    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound,
      videosProduced,
      errors,
    });
  }
}

main();
