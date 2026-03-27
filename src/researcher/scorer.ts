import type { ScoreBreakdown } from '../shared/types.js';
import type { SCSearchProduct, SCProductDetailResponse } from '../shared/scrape-creators-client.js';
import { getSoldCount, parseCount } from '../shared/scrape-creators-client.js';
import { loadConfig } from '../shared/config.js';

interface ScoringInput {
  searchProduct: SCSearchProduct;
  details: SCProductDetailResponse | null;
}

/**
 * Score shop quality using product rating as proxy (0-100).
 * Shop performance scores aren't available from ScrapeCreators,
 * so we use product rating (0-5) scaled to 0-100.
 */
function scoreShopPerformance(
  searchProduct: SCSearchProduct,
  details: SCProductDetailResponse | null,
): number {
  // Prefer detail review rating, fall back to search rating
  const rating = details?.product_detail_review?.product_rating
    ?? searchProduct.rate_info?.score
    ?? 0;

  const reviewCount = details?.product_detail_review?.review_count
    ?? searchProduct.rate_info?.review_count
    ?? 0;

  if (rating === 0 || reviewCount === 0) return 0;

  // Scale 0-5 rating to 0-100, with review count as confidence
  let score = (rating / 5) * 100;

  // Penalize low review counts (less confidence)
  if (reviewCount < 10) score *= 0.6;
  else if (reviewCount < 50) score *= 0.8;
  else if (reviewCount < 100) score *= 0.9;

  return Math.round(score);
}

/**
 * Estimate sales velocity as a 0-100 score based on sold_count.
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
  if (soldCount >= 10) return 15;
  return 5;
}

/**
 * Score video engagement from related promo videos (0-100).
 */
function scoreVideoEngagement(details: SCProductDetailResponse | null): number {
  if (!details || !details.related_videos || details.related_videos.length === 0) return 0;

  const videos = details.related_videos;
  const avgPlays = videos.reduce((sum, v) => sum + parseCount(v.play_count), 0) / videos.length;
  const avgLikes = videos.reduce((sum, v) => sum + parseCount(v.like_count), 0) / videos.length;

  const engagementRate = avgPlays > 0 ? avgLikes / avgPlays : 0;

  let playScore: number;
  if (avgPlays >= 1000000) playScore = 100;
  else if (avgPlays >= 500000) playScore = 85;
  else if (avgPlays >= 100000) playScore = 70;
  else if (avgPlays >= 50000) playScore = 55;
  else if (avgPlays >= 10000) playScore = 40;
  else if (avgPlays >= 1000) playScore = 25;
  else playScore = 10;

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
  if (!details) return 30;

  const imageCount = details.product_base?.images?.length ?? 0;
  const hasVideo = !!details.product_base?.desc_video?.video_infos?.length;
  const hasRelatedVideos = (details.related_videos?.length ?? 0) > 0;

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

  const soldCount = getSoldCount(input.searchProduct);
  const salesVelocity = scoreSalesVelocity(soldCount);
  const shopPerformance = scoreShopPerformance(input.searchProduct, input.details);
  const videoEngagement = scoreVideoEngagement(input.details);
  const assetAvailability = scoreAssetAvailability(input.details);

  const breakdown: ScoreBreakdown = {
    salesVelocity,
    shopPerformance,
    videoEngagement,
    assetAvailability,
  };

  const score = Math.round(
    salesVelocity * weights.salesVelocity +
    shopPerformance * weights.shopPerformance +
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

  // During pilot, require minimum shop quality (rating-based proxy)
  // Lowered from 95 to 80 since we're using rating proxy, not actual SPS
  const minShopPerf = config.channel.pilotProgramActive ? 80 : 0;

  return score >= minScore && shopPerformanceScore >= minShopPerf;
}
