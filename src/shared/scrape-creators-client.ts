import { loadConfig } from './config.js';

// --- Search endpoint types (match actual API response) ---

export interface SCSearchProduct {
  product_id: string;
  title: string;
  image: {
    height: number;
    width: number;
    uri: string;
    url_list: string[];
  } | null;
  product_price_info: {
    sale_price_format: string;
    sale_price_decimal: string;
    origin_price_format: string;
    origin_price_decimal: string;
    discount_format: string;
    currency_symbol: string;
  };
  rate_info: {
    score: number;
    review_count: number;
  } | null;
  sold_info: {
    sold_count: number;
  } | null;
  seller_info: {
    seller_id: string;
    shop_name: string;
    shop_logo: {
      url_list: string[];
    } | null;
  };
  seo_url: {
    canonical_url: string;
  };
}

export interface SCSearchResponse {
  success: boolean;
  query: string;
  total_products: number;
  products: SCSearchProduct[];
}

// --- Product detail types (flat structure, matches actual API) ---

export interface SCProductImage {
  height: number;
  width: number;
  thumb_url_list?: string[];
  url_list?: string[];
  uri?: string;
}

export interface SCReviewItem {
  review: {
    review_id: string;
    rating: number;
    display_text: string;
    images?: SCProductImage[];
  };
  user?: {
    nick_name: string;
  };
}

export interface SCRelatedVideo {
  item_id: string;
  play_count: string | number;
  like_count: string | number;
  duration: number;
  title: string;
  cover_image_url: string;
  content_url?: string;
  author_id: string;
}

export interface SCProductDetailResponse {
  success: boolean;
  credits_remaining?: number;
  product_id: string;
  seller_id: string;
  seller: {
    seller_id: string;
    name: string;
    avatar?: SCProductImage;
  };
  product_base: {
    title: string;
    images: SCProductImage[];
    desc_video?: {
      video_infos?: Array<{ main_url?: string; url_list?: string[] }>;
    };
  };
  skus?: Array<{
    sku_id: string;
    stock: number;
    price: {
      original_price: string;
      real_price: string;
      currency: string;
      currency_symbol: string;
    };
  }>;
  product_detail_review?: {
    product_rating: number;
    review_count: number;
    review_items: SCReviewItem[];
  };
  related_videos: SCRelatedVideo[];
}

export interface SCProductReviewsResponse {
  success: boolean;
  credits_remaining?: number;
  has_more: boolean;
  total_reviews: string;
  product_reviews: Array<{
    review_id: string;
    review_rating: number;
    review_text: string;
    reviewer_name: string;
    is_verified_purchase: boolean;
  }>;
  review_ratings: {
    review_count: number;
    overall_score: number;
  };
}

// --- Helpers ---

/** Safely extract sold_count, defaulting to 0 if null */
export function getSoldCount(product: SCSearchProduct): number {
  return product.sold_info?.sold_count ?? 0;
}

/** Safely extract rating score, defaulting to 0 if null */
export function getRating(product: SCSearchProduct): number {
  return product.rate_info?.score ?? 0;
}

/** Safely extract review count, defaulting to 0 if null */
export function getReviewCount(product: SCSearchProduct): number {
  return product.rate_info?.review_count ?? 0;
}

/** Get first image URL from a search product */
export function getImageUrl(product: SCSearchProduct): string {
  return product.image?.url_list?.[0] ?? '';
}

/** Get first image URL from a detail product image */
export function getDetailImageUrl(image: SCProductImage): string {
  return image.thumb_url_list?.[0] ?? image.url_list?.[0] ?? '';
}

/** Parse play/like counts which can be strings or numbers */
export function parseCount(value: string | number): number {
  if (typeof value === 'number') return value;
  return parseInt(value, 10) || 0;
}

// --- Client ---

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

export class ScrapeCreatorsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'ScrapeCreatorsError';
  }
}

export class ScrapeCreatorsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly region: string;

  constructor() {
    const apiKey = process.env['SCRAPECREATORS_API_KEY'];
    if (!apiKey) {
      throw new Error('SCRAPECREATORS_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;

    const config = loadConfig();
    this.baseUrl = config.sources.scrapeCreators.baseUrl;
    this.region = config.sources.scrapeCreators.searchRegion;
  }

  private async request<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const MAX_ATTEMPTS = 3;
    let lastError: ScrapeCreatorsError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as T;
        return data;
      }

      const error = new ScrapeCreatorsError(
        `API request failed: ${response.statusText}`,
        response.status,
        endpoint,
      );

      if (!RETRYABLE_CODES.has(response.status)) {
        throw error;
      }

      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        console.warn(
          `[ScrapeCreatorsClient] Retryable error ${response.status} on ${endpoint} — attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
      }
    }

    throw lastError!;
  }

  async searchProducts(query: string, page: number = 1): Promise<SCSearchResponse> {
    return this.request<SCSearchResponse>('/v1/tiktok/shop/search', {
      query,
      page: String(page),
      region: this.region,
    });
  }

  async getProductDetails(
    productUrl: string,
    includeVideos: boolean = true,
  ): Promise<SCProductDetailResponse> {
    const params: Record<string, string> = {
      url: productUrl,
      region: this.region,
    };
    if (includeVideos) {
      params['get_related_videos'] = 'true';
    }
    return this.request<SCProductDetailResponse>('/v1/tiktok/product', params);
  }

  async getProductReviews(
    productId: string,
    page: number = 1,
  ): Promise<SCProductReviewsResponse> {
    return this.request<SCProductReviewsResponse>('/v1/tiktok/shop/product/reviews', {
      product_id: productId,
      page: String(page),
    });
  }
}
