import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config so scorer doesn't try to read config.json from disk
vi.mock('../../shared/config.js', () => ({
  loadConfig: () => ({
    scoring: {
      minScoreToQueue: 65,
      weights: {
        salesVelocity: 0.35,
        shopPerformance: 0.30,
        videoEngagement: 0.20,
        assetAvailability: 0.15,
      },
    },
    channel: {
      pilotProgramActive: true,
    },
    video: {
      fontPath: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    },
  }),
}));

import { scoreProduct, meetsMinimumCriteria } from '../scorer.js';
import type { SCSearchProduct, SCProductDetailResponse } from '../../shared/scrape-creators-client.js';

function makeSearchProduct(overrides: Partial<SCSearchProduct> = {}): SCSearchProduct {
  return {
    product_id: 'test-id-001',
    title: 'Test Health Supplement',
    image: null,
    product_price_info: {
      sale_price_format: '$9.99',
      sale_price_decimal: '9.99',
      origin_price_format: '$12.99',
      origin_price_decimal: '12.99',
      discount_format: '23%',
      currency_symbol: '$',
    },
    rate_info: { score: 4.5, review_count: 150 },
    sold_info: { sold_count: 5000 },
    seller_info: {
      seller_id: 'seller-001',
      shop_name: 'HealthShop',
      shop_logo: null,
    },
    seo_url: { canonical_url: 'https://tiktokshop.com/product/test' },
    ...overrides,
  };
}

function makeDetails(overrides: Partial<SCProductDetailResponse> = {}): SCProductDetailResponse {
  return {
    success: true,
    product_id: 'test-id-001',
    seller_id: 'seller-001',
    seller: { seller_id: 'seller-001', name: 'HealthShop' },
    product_base: {
      title: 'Test Health Supplement 500mg 60 Capsules',
      images: [{ height: 800, width: 800, url_list: ['https://example.com/img1.jpg'] }],
    },
    product_detail_review: {
      product_rating: 4.5,
      review_count: 150,
      review_items: [],
    },
    related_videos: [],
    ...overrides,
  };
}

describe('scoreProduct', () => {
  describe('salesVelocity scoring', () => {
    it('returns score of 100 for salesVelocity when sold_count >= 50000', () => {
      const product = makeSearchProduct({ sold_info: { sold_count: 60000 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.salesVelocity).toBe(100);
    });

    it('returns score of 70 for salesVelocity when sold_count is 5000', () => {
      const product = makeSearchProduct({ sold_info: { sold_count: 5000 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.salesVelocity).toBe(70);
    });

    it('returns score of 15 for salesVelocity when sold_count is 50 (>= 10, < 100)', () => {
      const product = makeSearchProduct({ sold_info: { sold_count: 50 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.salesVelocity).toBe(15);
    });

    it('returns score of 5 for salesVelocity when sold_count is 0', () => {
      const product = makeSearchProduct({ sold_info: { sold_count: 0 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.salesVelocity).toBe(5);
    });

    it('returns score of 5 for salesVelocity when sold_info is null', () => {
      const product = makeSearchProduct({ sold_info: null });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.salesVelocity).toBe(5);
    });
  });

  describe('shopPerformance scoring', () => {
    it('returns 0 shopPerformance when no rating exists', () => {
      const product = makeSearchProduct({ rate_info: null });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.shopPerformance).toBe(0);
    });

    it('returns 0 shopPerformance when review count is 0', () => {
      const product = makeSearchProduct({ rate_info: { score: 4.8, review_count: 0 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.shopPerformance).toBe(0);
    });

    it('returns 100 for rating 5.0 with 150 reviews (no penalty above 100 reviews)', () => {
      const product = makeSearchProduct({ rate_info: { score: 5.0, review_count: 150 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      // 5/5 * 100 = 100; review_count >= 100 means no multiplier is applied
      expect(breakdown.shopPerformance).toBe(100);
    });

    it('penalizes low review count below 10 by 0.6 multiplier', () => {
      const product = makeSearchProduct({ rate_info: { score: 5.0, review_count: 5 } });
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      // 100 * 0.6 = 60
      expect(breakdown.shopPerformance).toBe(60);
    });

    it('prefers detail rating over search product rating', () => {
      const product = makeSearchProduct({ rate_info: { score: 3.0, review_count: 50 } });
      const details = makeDetails({
        product_detail_review: {
          product_rating: 4.8,
          review_count: 200,
          review_items: [],
        },
      });
      const { breakdown } = scoreProduct({ searchProduct: product, details });
      // detail rating 4.8/5 * 100 = 96; review_count 200 >= 100 so no penalty multiplier
      expect(breakdown.shopPerformance).toBe(96);
    });
  });

  describe('videoEngagement scoring', () => {
    it('returns 0 when no related_videos in details', () => {
      const product = makeSearchProduct();
      const details = makeDetails({ related_videos: [] });
      const { breakdown } = scoreProduct({ searchProduct: product, details });
      expect(breakdown.videoEngagement).toBe(0);
    });

    it('returns 0 when details is null', () => {
      const product = makeSearchProduct();
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.videoEngagement).toBe(0);
    });

    it('scores high for videos with >= 1M plays and >= 10% engagement', () => {
      const product = makeSearchProduct();
      const details = makeDetails({
        related_videos: [
          { item_id: 'v1', play_count: 2000000, like_count: 300000, duration: 30, title: 'test', cover_image_url: '', author_id: 'a1' },
        ],
      });
      const { breakdown } = scoreProduct({ searchProduct: product, details });
      // playScore=100, engRate=0.15>=0.10 -> engScore=100; combined=100*0.6+100*0.4=100
      expect(breakdown.videoEngagement).toBe(100);
    });

    it('handles string play/like counts correctly', () => {
      const product = makeSearchProduct();
      const details = makeDetails({
        related_videos: [
          { item_id: 'v1', play_count: '500000', like_count: '25000', duration: 30, title: 'test', cover_image_url: '', author_id: 'a1' },
        ],
      });
      const { breakdown } = scoreProduct({ searchProduct: product, details });
      // playScore=85, engRate=0.05 -> engScore=75; 85*0.6+75*0.4=51+30=81
      expect(breakdown.videoEngagement).toBe(81);
    });
  });

  describe('assetAvailability scoring', () => {
    it('returns 30 when details is null', () => {
      const product = makeSearchProduct();
      const { breakdown } = scoreProduct({ searchProduct: product, details: null });
      expect(breakdown.assetAvailability).toBe(30);
    });

    it('returns 50 for 5+ images with no video', () => {
      const imgs = Array.from({ length: 5 }, (_, i) => ({ height: 800, width: 800, url_list: [`https://ex.com/${i}.jpg`] }));
      const details = makeDetails({ product_base: { title: 'Test', images: imgs } });
      const { breakdown } = scoreProduct({ searchProduct: makeSearchProduct(), details });
      expect(breakdown.assetAvailability).toBe(50);
    });

    it('scores 100 for 5+ images, product video, and related videos', () => {
      const imgs = Array.from({ length: 5 }, (_, i) => ({ height: 800, width: 800, url_list: [`https://ex.com/${i}.jpg`] }));
      const details = makeDetails({
        product_base: {
          title: 'Test',
          images: imgs,
          desc_video: { video_infos: [{ main_url: 'https://example.com/vid.mp4' }] },
        },
        related_videos: [
          { item_id: 'v1', play_count: 100, like_count: 10, duration: 15, title: 't', cover_image_url: '', author_id: 'a' },
        ],
      });
      const { breakdown } = scoreProduct({ searchProduct: makeSearchProduct(), details });
      // 50 + 30 + 20 = 100
      expect(breakdown.assetAvailability).toBe(100);
    });
  });

  describe('composite score calculation', () => {
    it('applies correct weights to breakdown values', () => {
      const product = makeSearchProduct({ sold_info: { sold_count: 10000 }, rate_info: null });
      const details = makeDetails({ product_detail_review: undefined, related_videos: [] });
      const { score, breakdown } = scoreProduct({ searchProduct: product, details });

      // Manually verify: salesVelocity=80, shopPerf=0, videoEng=0, assetAvail=50 (5 images? no — details has 1 image)
      // assetAvail: 1 image = 20 score, no video = 0 + 0 => 20
      const expected = Math.round(
        breakdown.salesVelocity * 0.35 +
        breakdown.shopPerformance * 0.30 +
        breakdown.videoEngagement * 0.20 +
        breakdown.assetAvailability * 0.15,
      );
      expect(score).toBe(expected);
    });
  });
});

describe('meetsMinimumCriteria', () => {
  it('returns true when score and shopPerformance both meet thresholds', () => {
    // pilotProgramActive=true, minShopPerf=80, minScore=65
    expect(meetsMinimumCriteria(85, 70)).toBe(true);
  });

  it('returns false when score is below minScoreToQueue', () => {
    expect(meetsMinimumCriteria(90, 60)).toBe(false);
  });

  it('returns false when shopPerformanceScore is below 80 in pilot mode', () => {
    expect(meetsMinimumCriteria(75, 70)).toBe(false);
  });

  it('returns false when both score and shopPerformance are below thresholds', () => {
    expect(meetsMinimumCriteria(50, 40)).toBe(false);
  });

  it('returns true at exact threshold boundaries', () => {
    // shopPerf=80, score=65 => exactly on the line
    expect(meetsMinimumCriteria(80, 65)).toBe(true);
  });

  it('returns false when shopPerformance is exactly 79 (one below threshold)', () => {
    expect(meetsMinimumCriteria(79, 70)).toBe(false);
  });
});
