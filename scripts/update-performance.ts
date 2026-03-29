import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { updatePerformance } from '../src/analyst/index.js';
import { readPosted } from '../src/shared/state.js';
import type { VideoPerformance } from '../src/shared/types.js';

function printUsage(): void {
  console.log('Update performance metrics for a posted video.\n');
  console.log('Usage:');
  console.log('  tsx scripts/update-performance.ts <product-id> --views 1000 --likes 50 --clicks 10');
  console.log('  tsx scripts/update-performance.ts --file metrics.json\n');
  console.log('CLI flags: --views, --likes, --comments, --shares, --clicks, --conversions, --commission\n');
  console.log('JSON file format:');
  console.log('  [{ "productId": "abc123", "views": 1000, "likes": 50, ... }]\n');

  const posted = readPosted();
  if (posted.length > 0) {
    console.log('Posted videos:');
    for (const p of posted) {
      const v = p.performance.views;
      console.log(`  ${p.productId}  ${v > 0 ? `${v.toLocaleString()} views` : 'no data'}  ${p.productName.slice(0, 50)}`);
    }
  } else {
    console.log('No posted videos yet.');
  }
}

function parseCliMetrics(args: string[]): Partial<VideoPerformance> {
  const metrics: Partial<VideoPerformance> = {};
  const flagMap: Record<string, keyof VideoPerformance> = {
    '--views': 'views',
    '--likes': 'likes',
    '--comments': 'comments',
    '--shares': 'shares',
    '--clicks': 'clicks',
    '--conversions': 'conversions',
    '--commission': 'commissionEarned',
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    const key = flagMap[flag];
    if (key && i + 1 < args.length) {
      const value = parseFloat(args[i + 1]!);
      if (!isNaN(value)) {
        metrics[key] = value;
      }
      i++; // skip value
    }
  }

  return metrics;
}

interface BulkMetricEntry {
  productId: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  conversions?: number;
  commissionEarned?: number;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    return;
  }

  // Bulk mode: --file metrics.json
  if (args[0] === '--file') {
    const filePath = args[1];
    if (!filePath || !existsSync(filePath)) {
      console.error(`File not found: ${filePath ?? '(none)'}`);
      process.exit(1);
    }

    const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as BulkMetricEntry[];
    if (!Array.isArray(entries)) {
      console.error('JSON file must contain an array of metric objects');
      process.exit(1);
    }

    let updated = 0;
    for (const entry of entries) {
      const { productId, ...metrics } = entry;
      if (!productId) {
        console.error('Each entry must have a productId');
        continue;
      }
      updatePerformance(productId, metrics);
      updated++;
    }
    console.log(`\nUpdated ${updated} videos`);
    return;
  }

  // Single mode: <product-id> --views N --likes N ...
  const productId = args[0]!;
  const metrics = parseCliMetrics(args.slice(1));

  if (Object.keys(metrics).length === 0) {
    console.error('No metrics provided. Use flags like --views 1000 --likes 50');
    process.exit(1);
  }

  updatePerformance(productId, metrics);
}

main();
