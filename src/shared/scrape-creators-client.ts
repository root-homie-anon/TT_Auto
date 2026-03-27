import { loadConfig } from './config.js';

export interface SCSearchProduct {
  product_id: string;
  title: string;
  image: {
    height: number;
    width: number;
    uri: string;
    url_list: string[];
  };
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
  };
  sold_info: {
    sold_count: number;
  };
  seller_info: {
    seller_id: string;
    shop_name: string;
    shop_logo: {
      url_list: string[];
    };
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

export interface SCShopPerformance {
  score_percentile: number;
  type: string;
}

export interface SCStoreSubScore {
  score: number;
  type: string;
  score_percentage: number;
}

export interface SCProductImage {
  height: number;
  width: number;
  uri: string;
  url_list: string[];
}

export interface SCReviewItem {
  review_rating: number;
  review_text: string;
  reviewer_name: string;
  is_verified_purchase: boolean;
}

export interface SCRelatedVideo {
  item_id: string;
  play_count: number;
  like_count: number;
  duration: number;
  title: string;
  cover_image_url: string;
  content_url: string;
  url: string;
}

export interface SCProductDetailResponse {
  success: boolean;
  categories: string[];
  product_info: {
    product_id: string;
    seller_id: string;
    seller: {
      name: string;
      seller_id: string;
    };
    product_base: {
      title: string;
      sold_count: number;
      desc_video?: {
        video_infos: Array<{ url: string }>;
      };
      images: SCProductImage[];
      price: {
        original_price: string;
        real_price: string;
        discount: string;
        currency: string;
        currency_symbol: string;
      };
    };
    product_detail_review?: {
      product_rating: number;
      review_count: number;
      review_items: SCReviewItem[];
    };
  };
  shop_info: {
    seller_id: string;
    sold_count: number;
    shop_name: string;
    shop_rating: number;
    shop_link: string;
    store_sub_score: SCStoreSubScore[];
    review_count: number;
    followers_count: number;
  };
  shop_performance: SCShopPerformance[];
  related_videos: SCRelatedVideo[];
}

export interface SCProductReviewsResponse {
  success: boolean;
  has_more: boolean;
  total_reviews: string;
  product_reviews: SCReviewItem[];
  review_ratings: {
    review_count: number;
    overall_score: number;
  };
}

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
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new ScrapeCreatorsError(
        `API request failed: ${response.statusText}`,
        response.status,
        endpoint,
      );
    }

    const data = (await response.json()) as T;
    return data;
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
