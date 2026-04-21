import { accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'fs';
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
    maxRunMinutes?: number;
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

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export function validateEnvironment(): void {
  // 1. SCRAPECREATORS_API_KEY
  if (!process.env['SCRAPECREATORS_API_KEY']?.trim()) {
    throw new ConfigValidationError(
      'Missing SCRAPECREATORS_API_KEY. Add it to your .env file — see .env.example for the required key name.',
    );
  }

  // 2. ANTHROPIC_API_KEY
  if (!process.env['ANTHROPIC_API_KEY']?.trim()) {
    throw new ConfigValidationError(
      'Missing ANTHROPIC_API_KEY. Add it to your .env file — see .env.example for the required key name.',
    );
  }

  // 3. config.json is readable and parseable
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigValidationError(
      `Cannot read config.json: ${detail}. Ensure config.json exists at the project root and is valid JSON.`,
    );
  }

  // 4. Font file exists
  const fontPath = resolve(PROJECT_ROOT, config.video.fontPath);
  try {
    accessSync(fontPath, constants.F_OK);
  } catch {
    throw new ConfigValidationError(
      `Font file not found at "${fontPath}". Update config.video.fontPath in config.json to point to an existing font file.`,
    );
  }

  // 5. Output directory is writable
  const outputDir = resolve(PROJECT_ROOT, 'output');
  try {
    mkdirSync(outputDir, { recursive: true });
    const probe = resolve(outputDir, '.write-probe');
    writeFileSync(probe, '');
    unlinkSync(probe);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigValidationError(
      `Output directory "${outputDir}" is not writable: ${detail}. Check directory permissions.`,
    );
  }
}

export function loadConfig(): AppConfig {
  const raw = readFileSync(resolve(PROJECT_ROOT, 'config.json'), 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
