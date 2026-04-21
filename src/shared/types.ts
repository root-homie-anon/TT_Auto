export type ProductCategory =
  | 'supplements'
  | 'fitness-tools'
  | 'recovery'
  | 'sleep-wellness'
  | 'weight-management'
  | 'general-health';

export type ProductStatus =
  | 'queued'
  | 'assets_ready'
  | 'assets_failed'
  | 'script_ready'
  | 'script_failed'
  | 'video_ready'
  | 'video_failed'
  | 'post_ready'
  | 'posted'
  | 'dead_letter';

export type VideoFormat =
  | 'voiceover'
  | 'demo'
  | 'hook-text'
  | 'voiceover-before-after';

export interface TextOverlay {
  text: string;
  startSecond: number;
  endSecond: number;
}

export interface ProductScript {
  productId: string;
  format: VideoFormat;
  durationTargetSeconds: number;
  hook: {
    text: string;
    displaySeconds: number;
  };
  voiceover: string;
  overlays: TextOverlay[];
  caption: string;
  hashtags: string[];
  writtenAt: string;
}

export interface VideoResult {
  productId: string;
  videoPath: string;
  thumbnailPath: string;
  durationSeconds: number;
  format: VideoFormat;
  generationMethod: 'ffmpeg-slideshow' | 'kling' | 'runway';
  producedAt: string;
}

export interface ScoreBreakdown {
  salesVelocity: number;
  shopPerformance: number;
  videoEngagement: number;
  assetAvailability: number;
}

export interface QueuedProduct {
  id: string;
  productName: string;
  productUrl: string;
  tiktokShopId: string;
  category: ProductCategory;
  commissionRate: number | null;
  shopPerformanceScore: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  researchedAt: string;
  status: ProductStatus;
  soldCount: number;
  price: string;
  rating: number;
  reviewCount: number;
  sellerName: string;
  imageUrl: string;
  retryCount?: number;
  lastRetryAt?: string;
  failHistory?: FailRecord[];
}

export interface FailRecord {
  status: ProductStatus;
  error: string;
  timestamp: string;
  attempt: number;
}

export interface AssetManifest {
  productId: string;
  productName: string;
  productUrl: string;
  sellerName: string;
  price: string;
  commissionRate: number | null;
  description: string;
  keyBenefits: string[];
  ingredientsOrSpecs: string[];
  topReviews: ReviewData[];
  images: string[];
  hasVideo: boolean;
  videoPath: string;
  assetQualityScore: number;
  collectedAt: string;
}

export interface ReviewData {
  rating: number;
  text: string;
  reviewerName: string;
  isVerified: boolean;
}

export interface VideoQueueItem {
  productId: string;
  productName: string;
  videoPath: string;
  caption: string;
  hashtags: string[];
  productLink: string;
  suggestedPostTime: string;
  status: 'post_ready';
  queuedAt: string;
}

export interface PostedVideo {
  productId: string;
  productName: string;
  postedAt: string;
  tiktokVideoUrl: string;
  caption: string;
  performance: VideoPerformance;
}

export interface VideoPerformance {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  conversions: number;
  commissionEarned: number;
}

export interface AnalystSignals {
  updatedAt: string;
  highPerformingCategories: ProductCategory[];
  avoidCategories: ProductCategory[];
  winningFormats: string[];
  winningHookPatterns: string[];
  minCommissionRateThreshold: number;
  notes: string;
}

export interface LastRun {
  timestamp: string;
  productsFound: number;
  videosProduced: number;
  errors: string[];
}

export interface PipelineError {
  timestamp: string;
  agent: string;
  level?: 'info' | 'warn' | 'error';
  message: string;
  productId?: string;
  details?: string;
}

export interface ResearchLogEntry {
  productName: string;
  tiktokShopId: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  accepted: boolean;
  rejectReason?: string;
  researchedAt: string;
}
