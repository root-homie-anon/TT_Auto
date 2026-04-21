import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STATE_DIR = resolve(process.cwd(), '..', 'state');
const CONFIG_PATH = resolve(process.cwd(), '..', 'config.json');

function readJson<T>(filename: string, fallback: T): T {
  const path = resolve(STATE_DIR, filename);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export interface QueuedProduct {
  id: string;
  productName: string;
  productUrl: string;
  tiktokShopId: string;
  category: string;
  commissionRate: number | null;
  shopPerformanceScore: number;
  score: number;
  scoreBreakdown: {
    salesVelocity: number;
    shopPerformance: number;
    videoEngagement: number;
    assetAvailability: number;
  };
  researchedAt: string;
  status: string;
  soldCount: number;
  price: string;
  rating: number;
  reviewCount: number;
  sellerName: string;
  imageUrl: string;
}

export interface VideoQueueItem {
  productId: string;
  productName: string;
  videoPath: string;
  caption: string;
  hashtags: string[];
  productLink: string;
  suggestedPostTime: string;
  status: string;
  queuedAt: string;
}

export interface PostedVideo {
  productId: string;
  productName: string;
  postedAt: string;
  tiktokVideoUrl: string;
  caption: string;
  performance: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
    conversions: number;
    commissionEarned: number;
  };
}

export interface ResearchLogEntry {
  productName: string;
  tiktokShopId: string;
  score: number;
  scoreBreakdown: {
    salesVelocity: number;
    shopPerformance: number;
    videoEngagement: number;
    assetAvailability: number;
  };
  accepted: boolean;
  rejectReason?: string;
  researchedAt: string;
}

export interface AnalystSignals {
  updatedAt: string;
  highPerformingCategories: string[];
  avoidCategories: string[];
  winningFormats: string[];
  winningHookPatterns: string[];
  minCommissionRateThreshold: number;
  notes: string;
}

export type PipelineStage =
  | 'research'
  | 'assets'
  | 'script'
  | 'video'
  | 'package'
  | 'analyst'
  | 'done'
  | 'failed';

export interface LastRun {
  timestamp: string;
  productsFound: number;
  videosProduced: number;
  errors: string[];
  currentStage?: PipelineStage;
  stageStartedAt?: string;
  successCount?: number;
  failCount?: number;
}

export interface PipelineError {
  timestamp: string;
  agent: string;
  message: string;
  productId?: string;
}

export interface DashboardData {
  productQueue: QueuedProduct[];
  videoQueue: VideoQueueItem[];
  posted: PostedVideo[];
  researchLog: ResearchLogEntry[];
  analystSignals: AnalystSignals | null;
  lastRun: LastRun | null;
  errors: PipelineError[];
  config: Record<string, unknown>;
  liveRunning: boolean;
}

function readLiveRunning(): boolean {
  const lockPath = resolve(STATE_DIR, '.lock');
  if (!existsSync(lockPath)) return false;
  try {
    const lines = readFileSync(lockPath, 'utf-8').split('\n');
    const pid = parseInt(lines[0] ?? '', 10);
    if (isNaN(pid)) return false;
    // Signal 0 = existence check — does not send a signal, just checks PID
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export function getAllState(): DashboardData {
  let config: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { /* empty */ }
  }

  return {
    productQueue: readJson<QueuedProduct[]>('product-queue.json', []),
    videoQueue: readJson<VideoQueueItem[]>('video-queue.json', []),
    posted: readJson<PostedVideo[]>('posted.json', []),
    researchLog: readJson<ResearchLogEntry[]>('research-log.json', []),
    analystSignals: readJson<AnalystSignals | null>('analyst-signals.json', null),
    lastRun: readJson<LastRun | null>('last-run.json', null),
    errors: readJson<PipelineError[]>('errors.json', []),
    config,
    liveRunning: readLiveRunning(),
  };
}
