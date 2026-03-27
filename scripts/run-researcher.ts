import 'dotenv/config';
import { runResearcher } from '../src/researcher/index.js';
import { writeLastRun } from '../src/shared/state.js';

async function main(): Promise<void> {
  console.log('\n=== Health is Wealth — Researcher ===\n');

  const startTime = Date.now();
  const errors: string[] = [];

  try {
    const products = await runResearcher();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n--- Results ---`);
    console.log(`Products queued: ${products.length}`);
    console.log(`Time: ${elapsed}s`);

    if (products.length > 0) {
      console.log('\nQueued products:');
      for (const p of products) {
        console.log(`  [${p.score}] ${p.productName.slice(0, 60)} — ${p.price} (sold: ${p.soldCount.toLocaleString()})`);
      }
    }

    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound: products.length,
      videosProduced: 0,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal error: ${message}`);
    errors.push(message);

    writeLastRun({
      timestamp: new Date().toISOString(),
      productsFound: 0,
      videosProduced: 0,
      errors,
    });

    process.exit(1);
  }
}

main();
