import type { ScoreBreakdown } from '../shared/types.js';
import type { SCSearchProduct, SCProductDetailResponse, SCShopPerformance } from '../shared/scrape-creators-client.js';
import { loadConfig } from '../shared/config.js';

interface ScoringInput {
  searchProduct: SCSearchProduct;
  details: SCProductDetailResponse | null;
}

/**
 * Extract the overall shop performance percentile (0-100) from the
 * shop_performance array. The array contains entries typed by metric
 * (e.g. "product_quality", "logistics", "service"). We average all
 * percentiles to get one composite score.
 */
function getShopPerformanceScore(perf: SCShopPerformance[]): number {
  if (perf.length === 0) return 0;
  const total = perf.reduce((sum, p) => sum + p.score_percentile, 0);
  return Math.round(total / perf.length);
}

/**
 * Estimate sales velocity as a 0-100 score based on sold_count.
 * These thresholds are tuned for TikTok Shop health products.
 */
function scoreSalesVelocity(soldCount: number): number {
  if (soldCount >= 50000) return 100;
  if (soldCount >= 20000) return 90;
  if (soldCount >= 10000) return 80;
  if (soldCount >= 5000) return 70;
  if (soldCount >= 2000) return 60;
  if (soldCount >= 1000) return 50;
  if (soldCount >= 500) return 40;
  if (soldCount >= 100) return 25;
  return 10;
}

/**
 * Score video engagement from related promo videos (0-100).
 */
function scoreVideoEngagement(details: SCProductDetailResponse | null): number {
  if (!details || details.related_videos.length === 0) return 0;

  const videos = details.related_videos;
  const avgPlays = videos.reduce((sum, v) => sum + v.play_count, 0) / videos.length;
  const avgLikes = videos.reduce((sum, v) => sum + v.like_count, 0) / videos.length;

  // Engagement = likes/plays ratio, scaled
  const engagementRate = avgPlays > 0 ? avgLikes / avgPlays : 0;

  // High play counts are also a signal
  let playScore: number;
  if (avgPlays >= 1000000) playScore = 100;
  else if (avgPlays >= 500000) playScore = 85;
  else if (avgPlays >= 100000) playScore = 70;
  else if (avgPlays >= 50000) playScore = 55;
  else if (avgPlays >= 10000) playScore = 40;
  else if (avgPlays >= 1000) playScore = 25;
  else playScore = 10;

  // Engagement rate score
  let engScore: number;
  if (engagementRate >= 0.10) engScore = 100;
  else if (engagementRate >= 0.05) engScore = 75;
  else if (engagementRate >= 0.03) engScore = 50;
  else if (engagementRate >= 0.01) engScore = 30;
  else engScore = 10;

  return Math.round(playScore * 0.6 + engScore * 0.4);
}

/**
 * Score asset availability based on image count and video presence (0-100).
 */
function scoreAssetAvailability(details: SCProductDetailResponse | null): number {
  if (!details) return 30; // Can still proceed with search-level image

  const imageCount = details.product_info.product_base.images.length;
  const hasVideo = !!details.product_info.product_base.desc_video;
  const hasRelatedVideos = details.related_videos.length > 0;

  let score = 0;
  if (imageCount >= 5) score += 50;
  else if (imageCount >= 3) score += 40;
  else if (imageCount >= 1) score += 20;

  if (hasVideo) score += 30;
  if (hasRelatedVideos) score += 20;

  return Math.min(score, 100);
}

export function scoreProduct(input: ScoringInput): { score: number; breakdown: ScoreBreakdown } {
  const config = loadConfig();
  const weights = config.scoring.weights;

  const salesVelocity = scoreSalesVelocity(input.searchProduct.sold_info.sold_count);

  const shopPerf = input.details
    ? getShopPerformanceScore(input.details.shop_performance)
    : 0;

  const videoEngagement = scoreVideoEngagement(input.details);
  const assetAvailability = scoreAssetAvailability(input.details);

  const breakdown: ScoreBreakdown = {
    salesVelocity,
    shopPerformance: shopPerf,
    videoEngagement,
    assetAvailability,
  };

  const score = Math.round(
    salesVelocity * weights.salesVelocity +
    shopPerf * weights.shopPerformance +
    videoEngagement * weights.videoEngagement +
    assetAvailability * weights.assetAvailability,
  );

  return { score, breakdown };
}

export function meetsMinimumCriteria(
  shopPerformanceScore: number,
  score: number,
): boolean {
  const config = loadConfig();
  const minScore = config.scoring.minScoreToQueue;
  const minShopPerf = config.channel.pilotProgramActive
    ? config.channel.minShopPerformanceScore
    : 0;

  return score >= minScore && shopPerformanceScore >= minShopPerf;
}
