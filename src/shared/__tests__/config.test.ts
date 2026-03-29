import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAccessSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  accessSync: mockAccessSync,
  constants: { F_OK: 0 },
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  readFileSync: mockReadFileSync,
}));

const REAL_CONFIG = JSON.stringify({
  project: { name: 'Health is Wealth', slug: 'health-is-wealth', version: '1.0.0' },
  channel: {
    niche: 'health',
    tiktokHandle: '',
    pilotProgramActive: true,
    maxVideosPerWeek: 5,
    minShopPerformanceScore: 95,
  },
  pipeline: { productsPerRun: 5, videoFormats: ['voiceover'], autoSelectFormat: true },
  sources: {
    scrapeCreators: { enabled: true, baseUrl: 'https://api.scrapecreators.com', searchRegion: 'US' },
  },
  scoring: {
    minScoreToQueue: 65,
    weights: { salesVelocity: 0.35, shopPerformance: 0.30, videoEngagement: 0.20, assetAvailability: 0.15 },
  },
  tts: { provider: 'edge-tts', voiceId: 'en-US-GuyNeural' },
  video: {
    primaryGenerator: 'kling',
    fallbackGenerator: 'ffmpeg-slideshow',
    targetAspectRatio: '9:16',
    targetResolution: '1080x1920',
    fontPath: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  },
  posting: { optimalTimes: ['07:00', '12:00', '19:00'], timezone: 'America/New_York', minHoursBetweenPosts: 24 },
  features: { autoPost: false, multiChannel: false, analystFeedbackLoop: true },
});

import { validateEnvironment, ConfigValidationError } from '../config.js';

describe('validateEnvironment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SCRAPECREATORS_API_KEY: 'test-api-key',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
    };

    mockReadFileSync.mockReturnValue(REAL_CONFIG);
    mockAccessSync.mockReturnValue(undefined);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
    mockUnlinkSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('does not throw when all required environment variables and files are present', () => {
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('throws ConfigValidationError when SCRAPECREATORS_API_KEY is missing', () => {
    delete process.env['SCRAPECREATORS_API_KEY'];
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Missing SCRAPECREATORS_API_KEY');
  });

  it('throws ConfigValidationError when SCRAPECREATORS_API_KEY is empty string', () => {
    process.env['SCRAPECREATORS_API_KEY'] = '';
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when SCRAPECREATORS_API_KEY is whitespace only', () => {
    process.env['SCRAPECREATORS_API_KEY'] = '   ';
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Missing SCRAPECREATORS_API_KEY');
  });

  it('throws ConfigValidationError when ANTHROPIC_API_KEY is missing', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Missing ANTHROPIC_API_KEY');
  });

  it('throws ConfigValidationError when ANTHROPIC_API_KEY is empty string', () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when config.json cannot be parsed', () => {
    mockReadFileSync.mockReturnValue('{ invalid json }');
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Cannot read config.json');
  });

  it('throws ConfigValidationError when config.json does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Cannot read config.json');
  });

  it('throws ConfigValidationError when font file does not exist', () => {
    mockAccessSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('Font file not found');
  });

  it('throws ConfigValidationError when output directory is not writable', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    expect(() => validateEnvironment()).toThrow(ConfigValidationError);
    expect(() => validateEnvironment()).toThrow('is not writable');
  });

  it('throws the correct error class (ConfigValidationError not generic Error)', () => {
    delete process.env['SCRAPECREATORS_API_KEY'];
    let caught: unknown;
    try {
      validateEnvironment();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect((caught as ConfigValidationError).name).toBe('ConfigValidationError');
  });
});
