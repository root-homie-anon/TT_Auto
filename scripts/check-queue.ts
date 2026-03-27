import 'dotenv/config';
import { readProductQueue, readVideoQueue, readLastRun } from '../src/shared/state.js';
import { getDailyBriefing } from '../src/content-manager/index.js';

function main(): void {
  console.log('\n=== Health is Wealth — Queue Status ===\n');

  // Product queue
  const queue = readProductQueue();
  const byStatus = new Map<string, number>();
  for (const p of queue) {
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  }

  console.log(`Product queue: ${queue.length} total`);
  for (const [status, count] of byStatus) {
    console.log(`  ${status}: ${count}`);
  }

  // Show queued products
  const queued = queue.filter((p) => p.status === 'queued');
  if (queued.length > 0) {
    console.log('\nQueued (awaiting assets):');
    for (const p of queued) {
      console.log(`  [${p.score}] ${p.productName.slice(0, 55)} — ${p.price}`);
    }
  }

  const ready = queue.filter((p) => p.status === 'assets_ready');
  if (ready.length > 0) {
    console.log('\nAssets ready (awaiting script/video):');
    for (const p of ready) {
      console.log(`  ${p.productName.slice(0, 55)} — ${p.category}`);
    }
  }

  // Video queue
  const videoQueue = readVideoQueue();
  if (videoQueue.length > 0) {
    console.log(`\nVideos ready to post: ${videoQueue.length}`);
    for (const v of videoQueue) {
      console.log(`  ${v.productName.slice(0, 55)} — post at ${new Date(v.suggestedPostTime).toLocaleString()}`);
    }
  }

  // Last run
  const lastRun = readLastRun();
  if (lastRun) {
    console.log(`\nLast run: ${new Date(lastRun.timestamp).toLocaleString()}`);
    console.log(`  Products found: ${lastRun.productsFound}`);
    if (lastRun.errors.length > 0) {
      console.log(`  Errors: ${lastRun.errors.length}`);
    }
  }

  // Daily briefing
  console.log('\n' + getDailyBriefing());
}

main();
