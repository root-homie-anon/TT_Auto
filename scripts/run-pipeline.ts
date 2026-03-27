import 'dotenv/config';
import { runResearcher } from '../src/researcher/index.js';
import { collectAllAssets } from '../src/asset-collector/index.js';
import { getDailyBriefing } from '../src/content-manager/index.js';
import { generateSignals } from '../src/analyst/index.js';
import { writeLastRun } from '../src/shared/state.js';

async function main(): Promise<void> {
  console.log('\n=== Health is Wealth — Full Pipeline ===\n');

  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0;

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

    // Step 3: Scriptwriter + Video Producer
    // These are handled externally (user has VO, scriptwriter, video gen ready)
    console.log('\n--- Step 3: Script & Video ---');
    console.log('Scriptwriter and video production handled externally.');
    console.log('Run scripts/run-video.ts per product when ready.');

    // Step 4: Update analyst signals
    console.log('\n--- Step 4: Analyst Signals ---');
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
      videosProduced: 0,
      errors,
    });
  }
}

main();
