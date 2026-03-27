import 'dotenv/config';
import { readProductQueue } from '../src/shared/state.js';
import { buildPostingPackage } from '../src/content-manager/index.js';

function main(): void {
  const productId = process.argv[2];

  if (!productId) {
    console.log('Usage: tsx scripts/run-video.ts <product-id>');
    console.log('');

    // Show available products
    const queue = readProductQueue();
    const ready = queue.filter((p) => p.status === 'assets_ready');

    if (ready.length > 0) {
      console.log('Products with assets ready:');
      for (const p of ready) {
        console.log(`  ${p.tiktokShopId}  ${p.productName.slice(0, 50)}`);
      }
    } else {
      console.log('No products with assets ready. Run the pipeline first.');
    }
    return;
  }

  const queue = readProductQueue();
  const product = queue.find((p) => p.tiktokShopId === productId || p.id === productId);

  if (!product) {
    console.error(`Product not found: ${productId}`);
    process.exit(1);
  }

  // NOTE: Video generation is handled externally.
  // This script packages the result once a video file exists.
  const videoPath = process.argv[3];

  if (!videoPath) {
    console.log(`Product: ${product.productName}`);
    console.log(`Status: ${product.status}`);
    console.log('');
    console.log('To package a completed video:');
    console.log(`  tsx scripts/run-video.ts ${productId} /path/to/video.mp4`);
    return;
  }

  const result = buildPostingPackage(product, videoPath);
  if (result) {
    console.log(`\nPosting package created at: output/ready/${product.tiktokShopId}/`);
  }
}

main();
