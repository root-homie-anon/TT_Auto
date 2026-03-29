import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { readProductQueue, writeProductQueue } from '../src/shared/state.js';
import { getProjectRoot } from '../src/shared/config.js';
import { writeScript } from '../src/scriptwriter/index.js';
import { produceVideo } from '../src/video-producer/index.js';
import { buildPostingPackage } from '../src/content-manager/index.js';
import type { AssetManifest, ProductScript } from '../src/shared/types.js';

async function main(): Promise<void> {
  const productId = process.argv[2];

  if (!productId) {
    console.log('Usage: tsx scripts/run-video.ts <product-id>');
    console.log('');

    const queue = readProductQueue();
    const ready = queue.filter((p) =>
      p.status === 'assets_ready' || p.status === 'script_ready',
    );

    if (ready.length > 0) {
      console.log('Products ready for video generation:');
      for (const p of ready) {
        console.log(`  ${p.tiktokShopId}  [${p.status}]  ${p.productName.slice(0, 50)}`);
      }
    } else {
      console.log('No products ready. Run the pipeline first.');
    }
    return;
  }

  const queue = readProductQueue();
  const product = queue.find((p) => p.tiktokShopId === productId || p.id === productId);

  if (!product) {
    console.error(`Product not found: ${productId}`);
    process.exit(1);
  }

  const root = getProjectRoot();
  const manifestPath = resolve(root, 'output', 'assets', product.tiktokShopId, 'meta.json');

  if (!existsSync(manifestPath)) {
    console.error(`No asset manifest found for ${product.tiktokShopId}. Run asset collection first.`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AssetManifest;

  // Step 1: Generate script (if not already done)
  let script: ProductScript | null = null;
  const scriptPath = resolve(root, 'output', 'assets', product.tiktokShopId, 'script.json');

  if (existsSync(scriptPath) && product.status !== 'assets_ready') {
    script = JSON.parse(readFileSync(scriptPath, 'utf-8')) as ProductScript;
    console.log(`Using existing script for ${product.productName.slice(0, 50)}`);
  } else {
    console.log('--- Generating script ---');
    script = await writeScript(product, manifest);
    if (script) {
      const q = readProductQueue();
      const idx = q.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        q[idx]!.status = 'script_ready';
        writeProductQueue(q);
      }
    }
  }

  if (!script) {
    console.error('Script generation failed');
    process.exit(1);
  }

  // Step 2: Produce video
  console.log('--- Producing video ---');
  const result = await produceVideo(product, script, manifest);

  if (!result) {
    console.error('Video production failed');
    process.exit(1);
  }

  // Step 3: Update status and package
  const q = readProductQueue();
  const idx = q.findIndex((p) => p.id === product.id);
  if (idx !== -1) {
    q[idx]!.status = 'video_ready';
    writeProductQueue(q);
  }

  console.log('--- Packaging for posting ---');
  const pkg = buildPostingPackage(product, result.videoPath);
  if (pkg) {
    console.log(`\nPosting package created at: output/ready/${product.tiktokShopId}/`);
  }
}

main();
