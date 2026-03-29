import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface AppConfig {
  project: {
    name: string;
    slug: string;
    version: string;
  };
  channel: {
    niche: string;
    tiktokHandle: string;
    pilotProgramActive: boolean;
    maxVideosPerWeek: number;
    minShopPerformanceScore: number;
  };
  pipeline: {
    productsPerRun: number;
    videoFormats: string[];
    autoSelectFormat: boolean;
  };
  sources: {
    scrapeCreators: {
      enabled: boolean;
      baseUrl: string;
      searchRegion: string;
    };
  };
  scoring: {
    minScoreToQueue: number;
    weights: {
      salesVelocity: number;
      shopPerformance: number;
      videoEngagement: number;
      assetAvailability: number;
    };
  };
  tts: {
    provider: string;
    voiceId: string;
  };
  video: {
    primaryGenerator: string;
    fallbackGenerator: string;
    targetAspectRatio: string;
    targetResolution: string;
    fontPath: string;
  };
  posting: {
    optimalTimes: string[];
    timezone: string;
    minHoursBetweenPosts: number;
  };
  features: {
    autoPost: boolean;
    multiChannel: boolean;
    analystFeedbackLoop: boolean;
  };
}

const PROJECT_ROOT = resolve(import.meta.dirname, '../../');

export function loadConfig(): AppConfig {
  const raw = readFileSync(resolve(PROJECT_ROOT, 'config.json'), 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
