import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ScrapeCreatorsClient, getDetailImageUrl } from '../shared/scrape-creators-client.js';
import { getProjectRoot } from '../shared/config.js';
import { readProductQueue, writeProductQueue, appendError, readErrors } from '../shared/state.js';
import type { QueuedProduct, AssetManifest, ReviewData, FailRecord } from '../shared/types.js';
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
  const reviewItems = details.product_detail_review?.review_items ?? [];
  return reviewItems
    .filter((r) => r.review.rating >= 4 && r.review.display_text.length > 10)
    .slice(0, 5)
    .map((r) => ({
      rating: r.review.rating,
      text: r.review.display_text,
      reviewerName: r.user?.nick_name ?? 'Anonymous',
      isVerified: true,
    }));
}

function extractBenefits(details: SCProductDetailResponse): string[] {
  const benefits: string[] = [];
  const title = details.product_base.title.toLowerCase();

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

  const reviews = details.product_detail_review?.review_items ?? [];
  for (const review of reviews.slice(0, 10)) {
    const text = review.review.display_text.toLowerCase();
    for (const keyword of benefitKeywords) {
      if (text.includes(keyword) && !benefits.includes(keyword)) {
        benefits.push(keyword);
      }
    }
  }

  return benefits.slice(0, 6);
}

function extractSpecs(details: SCProductDetailResponse): string[] {
  const specs: Set<string> = new Set();
  const title = details.product_base.title.toLowerCase();

  // Common health product ingredients and specs found in titles
  const ingredientPatterns = [
    /(\d+\s*mg)\b/gi,           // dosage: "500mg", "1000 mg"
    /(\d+\s*mcg)\b/gi,          // micrograms
    /(\d+\s*iu)\b/gi,           // international units
    /(\d+\s*billion\s*cfu)\b/gi, // probiotic count
    /(\d+\s*count)\b/gi,        // count per bottle
    /(\d+\s*capsules?)\b/gi,    // capsule count
    /(\d+\s*gummies)\b/gi,      // gummy count
    /(\d+\s*tablets?)\b/gi,     // tablet count
    /(\d+\s*oz)\b/gi,           // weight/volume
    /(\d+\s*ml)\b/gi,           // milliliters
  ];

  for (const pattern of ingredientPatterns) {
    const matches = details.product_base.title.match(pattern);
    if (matches) {
      for (const match of matches) {
        specs.add(match.trim());
      }
    }
  }

  // Known supplement ingredients
  const ingredients = [
    'vitamin d', 'vitamin c', 'vitamin b12', 'vitamin b6', 'vitamin k',
    'magnesium', 'zinc', 'iron', 'calcium', 'potassium', 'selenium',
    'collagen', 'biotin', 'melatonin', 'ashwagandha', 'turmeric',
    'omega-3', 'fish oil', 'probiotics', 'elderberry', 'echinacea',
    'ginseng', 'coq10', 'l-theanine', 'creatine', 'protein',
    'hyaluronic acid', 'glucosamine', 'chondroitin', 'mct oil',
    'apple cider vinegar', 'spirulina', 'chlorella', 'berberine',
  ];

  for (const ingredient of ingredients) {
    if (title.includes(ingredient)) {
      specs.add(ingredient);
    }
  }

  // Check reviews for ingredient mentions
  const reviews = details.product_detail_review?.review_items ?? [];
  for (const review of reviews.slice(0, 5)) {
    const text = review.review.display_text.toLowerCase();
    for (const ingredient of ingredients) {
      if (text.includes(ingredient) && !specs.has(ingredient)) {
        specs.add(ingredient);
      }
    }
  }

  const result = [...specs].slice(0, 10);
  if (result.length === 0) {
    console.log('[asset-collector] No ingredients/specs found in product data');
  } else {
    console.log(`[asset-collector] Extracted ${result.length} specs: ${result.join(', ')}`);
  }

  return result;
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

  const productBase = details.product_base;
  const images = productBase?.images ?? [];

  if (images.length < MIN_IMAGES) {
    console.log(
      `[asset-collector] Insufficient images (${images.length}/${MIN_IMAGES}) — skipping`,
    );
    appendError({
      timestamp: new Date().toISOString(),
      agent: 'asset-collector',
      message: `Insufficient images: ${images.length}/${MIN_IMAGES}`,
      productId: product.tiktokShopId,
    });
    return null;
  }

  // Download images
  const imgDir = imagesDir(product.tiktokShopId);
  const savedImages: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!image) continue;
    const url = getDetailImageUrl(image);
    if (!url) continue;

    const ext = url.includes('.png') ? 'png' : 'jpg';
    const filename = `image-${i + 1}.${ext}`;
    const dest = resolve(imgDir, filename);

    console.log(`[asset-collector] Downloading image ${i + 1}/${images.length}`);
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

  const videoInfos = productBase?.desc_video?.video_infos;
  if (videoInfos?.length) {
    const videoUrl = videoInfos[0]?.main_url ?? videoInfos[0]?.url_list?.[0];
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

  // Get price from SKUs or product name
  const price = details.skus?.[0]?.price
    ? `${details.skus[0].price.currency_symbol}${details.skus[0].price.real_price}`
    : product.price;

  // Build asset quality score
  let qualityScore = 0;
  qualityScore += Math.min(savedImages.length * 10, 40);
  qualityScore += hasVideo ? 25 : 0;
  qualityScore += Math.min(reviews.length * 5, 20);
  qualityScore += Math.min(benefits.length * 3, 15);

  const manifest: AssetManifest = {
    productId: product.tiktokShopId,
    productName: product.productName,
    productUrl: product.productUrl,
    sellerName: details.seller?.name ?? product.sellerName,
    price,
    commissionRate: null,
    description: productBase.title,
    keyBenefits: benefits,
    ingredientsOrSpecs: extractSpecs(details),
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
  console.log(`[asset-collector] Assets saved for ${product.productName.slice(0, 50)} (quality: ${qualityScore})`);

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

    const currentQueue = readProductQueue();
    const idx = currentQueue.findIndex((p) => p.id === product.id);
    if (idx !== -1) {
      const updated = currentQueue[idx]!;
      if (manifest) {
        updated.status = 'assets_ready';
      } else {
        updated.status = 'assets_failed';
        // Find the most recent error written for this product during collectAssets
        const allErrors = readErrors();
        const latestError = [...allErrors]
          .reverse()
          .find((e) => e.productId === product.tiktokShopId && e.agent === 'asset-collector');
        const failRecord: FailRecord = {
          status: 'assets_failed',
          error: latestError?.message ?? 'Asset collection failed (unknown reason)',
          timestamp: new Date().toISOString(),
          attempt: (updated.failHistory?.filter((r) => r.status === 'assets_failed').length ?? 0) + 1,
        };
        updated.failHistory = [...(updated.failHistory ?? []), failRecord];
      }
      writeProductQueue(currentQueue);
    }
  }

  console.log('[asset-collector] Asset collection complete');
}
