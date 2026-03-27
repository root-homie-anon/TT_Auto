import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ScrapeCreatorsClient } from '../shared/scrape-creators-client.js';
import { getProjectRoot } from '../shared/config.js';
import { readProductQueue, writeProductQueue, appendError } from '../shared/state.js';
import type { QueuedProduct, AssetManifest, ReviewData } from '../shared/types.js';
import type { SCProductDetailResponse } from '../shared/scrape-creators-client.js';

const MIN_IMAGES = 3;

function assetDir(productId: string): string {
  const dir = resolve(getProjectRoot(), 'output', 'assets', productId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function imagesDir(productId: string): string {
  const dir = resolve(assetDir(productId), 'images');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function videoDir(productId: string): string {
  const dir = resolve(assetDir(productId), 'video');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(dest, buffer);
    return true;
  } catch {
    return false;
  }
}

function extractReviews(details: SCProductDetailResponse): ReviewData[] {
  const reviewItems = details.product_info.product_detail_review?.review_items ?? [];
  return reviewItems
    .filter((r) => r.review_rating >= 4 && r.review_text.length > 20)
    .slice(0, 5)
    .map((r) => ({
      rating: r.review_rating,
      text: r.review_text,
      reviewerName: r.reviewer_name,
      isVerified: r.is_verified_purchase,
    }));
}

function extractBenefits(details: SCProductDetailResponse): string[] {
  // Extract key benefits from title and reviews
  const benefits: string[] = [];
  const title = details.product_info.product_base.title.toLowerCase();

  const benefitKeywords = [
    'energy', 'immune', 'sleep', 'recovery', 'muscle', 'weight loss',
    'digestion', 'skin', 'hair', 'joint', 'focus', 'stress', 'pain relief',
    'anti-aging', 'detox', 'strength', 'endurance', 'flexibility',
    'relaxation', 'inflammation', 'metabolism', 'hydration',
  ];

  for (const keyword of benefitKeywords) {
    if (title.includes(keyword)) {
      benefits.push(keyword);
    }
  }

  // Also check top reviews for common benefit mentions
  const reviews = details.product_info.product_detail_review?.review_items ?? [];
  for (const review of reviews.slice(0, 10)) {
    const text = review.review_text.toLowerCase();
    for (const keyword of benefitKeywords) {
      if (text.includes(keyword) && !benefits.includes(keyword)) {
        benefits.push(keyword);
      }
    }
  }

  return benefits.slice(0, 6);
}

export async function collectAssets(product: QueuedProduct): Promise<AssetManifest | null> {
  const client = new ScrapeCreatorsClient();

  console.log(`[asset-collector] Collecting assets for: ${product.productName.slice(0, 60)}`);

  let details: SCProductDetailResponse;
  try {
    details = await client.getProductDetails(product.productUrl, true);
    if (!details.success) {
      throw new Error('API returned success: false');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[asset-collector] Failed to fetch product details: ${message}`);
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'asset-collector',
      message: `Detail fetch failed: ${message}`,
      productId: product.tiktokShopId,
    });
    return null;
  }

  const productBase = details.product_info.product_base;

  // Check minimum image count
  if (productBase.images.length < MIN_IMAGES) {
    console.log(
      `[asset-collector] Insufficient images (${productBase.images.length}/${MIN_IMAGES}) — skipping`,
    );
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'asset-collector',
      message: `Insufficient images: ${productBase.images.length}/${MIN_IMAGES}`,
      productId: product.tiktokShopId,
    });
    return null;
  }

  // Download images
  const imgDir = imagesDir(product.tiktokShopId);
  const savedImages: string[] = [];

  for (let i = 0; i < productBase.images.length; i++) {
    const image = productBase.images[i];
    if (!image) continue;
    const url = image.url_list[0];
    if (!url) continue;

    const ext = url.includes('.png') ? 'png' : 'jpg';
    const filename = `image-${i + 1}.${ext}`;
    const dest = resolve(imgDir, filename);

    console.log(`[asset-collector] Downloading image ${i + 1}/${productBase.images.length}`);
    const ok = await downloadFile(url, dest);
    if (ok) {
      savedImages.push(dest);
    }
  }

  if (savedImages.length < MIN_IMAGES) {
    console.log(
      `[asset-collector] Only downloaded ${savedImages.length}/${MIN_IMAGES} images — skipping`,
    );
    return null;
  }

  // Download product video if available
  let videoPath = '';
  let hasVideo = false;

  if (productBase.desc_video?.video_infos?.length) {
    const videoUrl = productBase.desc_video.video_infos[0]?.url;
    if (videoUrl) {
      const vDir = videoDir(product.tiktokShopId);
      const dest = resolve(vDir, 'product-video.mp4');
      console.log('[asset-collector] Downloading product video...');
      const ok = await downloadFile(videoUrl, dest);
      if (ok) {
        videoPath = dest;
        hasVideo = true;
      }
    }
  }

  // Extract reviews and benefits
  const reviews = extractReviews(details);
  const benefits = extractBenefits(details);

  // Build asset quality score
  let qualityScore = 0;
  qualityScore += Math.min(savedImages.length * 10, 40); // max 40 for images
  qualityScore += hasVideo ? 25 : 0;
  qualityScore += Math.min(reviews.length * 5, 20); // max 20 for reviews
  qualityScore += Math.min(benefits.length * 3, 15); // max 15 for benefits

  const manifest: AssetManifest = {
    productId: product.tiktokShopId,
    productName: product.productName,
    productUrl: product.productUrl,
    sellerName: details.product_info.seller.name,
    price: `${productBase.price.currency_symbol}${productBase.price.real_price}`,
    commissionRate: null,
    description: productBase.title,
    keyBenefits: benefits,
    ingredientsOrSpecs: [],
    topReviews: reviews,
    images: savedImages,
    hasVideo,
    videoPath,
    assetQualityScore: Math.min(qualityScore, 100),
    collectedAt: new Date().toISOString(),
  };

  // Save manifest
  const manifestPath = resolve(assetDir(product.tiktokShopId), 'meta.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`[asset-collector] ✓ Assets saved for ${product.productName.slice(0, 50)} (quality: ${qualityScore})`);

  return manifest;
}

export async function collectAllAssets(): Promise<void> {
  const queue = readProductQueue();
  const pendingProducts = queue.filter((p) => p.status === 'queued');

  if (pendingProducts.length === 0) {
    console.log('[asset-collector] No queued products to collect assets for');
    return;
  }

  console.log(`[asset-collector] Processing ${pendingProducts.length} products`);

  for (const product of pendingProducts) {
    const manifest = await collectAssets(product);

    // Update status in queue
    const currentQueue = readProductQueue();
    const idx = currentQueue.findIndex((p) => p.id === product.id);
    if (idx !== -1) {
      const updated = currentQueue[idx]!;
      updated.status = manifest ? 'assets_ready' : 'assets_failed';
      writeProductQueue(currentQueue);
    }
  }

  console.log('[asset-collector] Asset collection complete');
}
