import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { readProductQueue, writeProductQueue } from '../src/shared/state.js';

function printUsage(): void {
  console.log('Set commission rates for queued products.\n');
  console.log('Usage:');
  console.log('  tsx scripts/update-commission.ts <product-id> <rate>');
  console.log('  tsx scripts/update-commission.ts --file commissions.json\n');
  console.log('Rate is a decimal (e.g., 0.15 for 15%).\n');
  console.log('JSON file format:');
  console.log('  [{ "productId": "abc123", "rate": 0.15 }]\n');

  const queue = readProductQueue();
  if (queue.length > 0) {
    console.log('Current products:');
    for (const p of queue) {
      const rate = p.commissionRate !== null ? `${(p.commissionRate * 100).toFixed(1)}%` : 'not set';
      console.log(`  ${p.tiktokShopId}  ${rate}  ${p.productName.slice(0, 50)}`);
    }
  } else {
    console.log('No products in queue.');
  }
}

interface BulkEntry {
  productId: string;
  rate: number;
}

function setCommissionRate(productId: string, rate: number): boolean {
  if (rate < 0 || rate > 1) {
    console.error(`Invalid rate ${rate} for ${productId} — must be between 0 and 1`);
    return false;
  }

  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.tiktokShopId === productId);
  if (idx === -1) {
    console.error(`Product ${productId} not found in queue`);
    return false;
  }

  queue[idx]!.commissionRate = rate;
  writeProductQueue(queue);
  console.log(`[commission] Set ${productId} → ${(rate * 100).toFixed(1)}%`);
  return true;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    return;
  }

  // Bulk mode
  if (args[0] === '--file') {
    const filePath = args[1];
    if (!filePath || !existsSync(filePath)) {
      console.error(`File not found: ${filePath ?? '(none)'}`);
      process.exit(1);
    }

    const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as BulkEntry[];
    if (!Array.isArray(entries)) {
      console.error('JSON file must contain an array of { productId, rate } objects');
      process.exit(1);
    }

    let updated = 0;
    for (const entry of entries) {
      if (setCommissionRate(entry.productId, entry.rate)) updated++;
    }
    console.log(`\nUpdated ${updated} products`);
    return;
  }

  // Single mode
  const productId = args[0]!;
  const rate = parseFloat(args[1] ?? '');

  if (isNaN(rate)) {
    console.error('Rate must be a number (e.g., 0.15 for 15%)');
    process.exit(1);
  }

  setCommissionRate(productId, rate);
}

main();
