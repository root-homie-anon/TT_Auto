import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockReadFileSync,
  mockWriteFileSync,
  mockExistsSync,
  mockMkdirSync,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('../config.js', () => ({
  getProjectRoot: () => '/tmp/tt-auto-test',
  loadConfig: () => ({
    scoring: {
      minScoreToQueue: 65,
      weights: { salesVelocity: 0.35, shopPerformance: 0.30, videoEngagement: 0.20, assetAvailability: 0.15 },
    },
    channel: { pilotProgramActive: true },
    video: { fontPath: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  }),
}));

import { trimErrors, writeLastRun, readLastRun, getRetryableProducts } from '../state.js';
import type { PipelineError, LastRun, QueuedProduct, FailRecord } from '../types.js';

function makeError(daysOld: number, agent = 'researcher'): PipelineError {
  const ts = new Date();
  ts.setDate(ts.getDate() - daysOld);
  return {
    timestamp: ts.toISOString(),
    agent,
    message: `Test error from ${daysOld} days ago`,
  };
}

describe('trimErrors', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps errors newer than 7 days and removes older ones', () => {
    const errors: PipelineError[] = [
      makeError(1),   // keep
      makeError(3),   // keep
      makeError(6),   // keep
      makeError(8),   // remove
      makeError(10),  // remove
    ];

    mockReadFileSync.mockReturnValue(JSON.stringify(errors));

    trimErrors();

    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as PipelineError[];
    expect(written).toHaveLength(3);
    written.forEach((e) => {
      const age = (Date.now() - new Date(e.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      expect(age).toBeLessThan(7);
    });
  });

  it('does not write to disk when no errors are trimmed', () => {
    const errors: PipelineError[] = [
      makeError(1),
      makeError(2),
    ];

    mockReadFileSync.mockReturnValue(JSON.stringify(errors));

    trimErrors();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('writes empty array when all errors are older than 7 days', () => {
    const errors: PipelineError[] = [
      makeError(8),
      makeError(14),
      makeError(30),
    ];

    mockReadFileSync.mockReturnValue(JSON.stringify(errors));

    trimErrors();

    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as PipelineError[];
    expect(written).toEqual([]);
  });

  it('handles empty errors file gracefully without writing', () => {
    // When the file does not exist, readJson returns the fallback []
    mockExistsSync.mockReturnValue(false);

    trimErrors();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('preserves error properties after trimming', () => {
    const recentError: PipelineError = {
      timestamp: new Date().toISOString(),
      agent: 'scriptwriter',
      message: 'Script generation failed',
      productId: 'prod-001',
      details: 'API timeout',
    };
    const oldError = makeError(10);

    mockReadFileSync.mockReturnValue(JSON.stringify([recentError, oldError]));

    trimErrors();

    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as PipelineError[];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      agent: 'scriptwriter',
      message: 'Script generation failed',
      productId: 'prod-001',
      details: 'API timeout',
    });
  });

  it('keeps only errors from the last 7 days when given a mixed list of 20', () => {
    // 10 recent (0-6 days), 10 old (8-17 days)
    const errors: PipelineError[] = [
      ...Array.from({ length: 10 }, (_, i) => makeError(i)),       // 0-9 days (first 7 kept)
      ...Array.from({ length: 10 }, (_, i) => makeError(8 + i)),   // 8-17 days (all removed)
    ];

    mockReadFileSync.mockReturnValue(JSON.stringify(errors));

    trimErrors();

    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as PipelineError[];
    // errors at 0-6 days old are kept (7 entries); 7 days old and beyond are removed
    expect(written.length).toBeLessThanOrEqual(7);
    expect(written.length).toBeGreaterThan(0);
  });
});

describe('writeLastRun / readLastRun — stage heartbeat', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockClear();
    mockReadFileSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists currentStage and stageStartedAt when writing a heartbeat', () => {
    const now = new Date().toISOString();
    const run: LastRun = {
      timestamp: now,
      productsFound: 3,
      videosProduced: 0,
      errors: [],
      currentStage: 'assets',
      stageStartedAt: now,
    };

    writeLastRun(run);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as LastRun;
    expect(written.currentStage).toBe('assets');
    expect(written.stageStartedAt).toBe(now);
  });

  it('reads back the stage written by writeLastRun', () => {
    const now = new Date().toISOString();
    const run: LastRun = {
      timestamp: now,
      productsFound: 5,
      videosProduced: 2,
      errors: [],
      currentStage: 'done',
      stageStartedAt: now,
    };

    mockReadFileSync.mockReturnValue(JSON.stringify(run));

    const result = readLastRun();
    expect(result?.currentStage).toBe('done');
    expect(result?.stageStartedAt).toBe(now);
  });

  it('records failed stage when pipeline errors exist', () => {
    const now = new Date().toISOString();
    const run: LastRun = {
      timestamp: now,
      productsFound: 2,
      videosProduced: 0,
      errors: ['Video generation timed out'],
      currentStage: 'failed',
      stageStartedAt: now,
    };

    writeLastRun(run);

    const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as LastRun;
    expect(written.currentStage).toBe('failed');
    expect(written.errors).toHaveLength(1);
  });

  it('stage transitions across all valid values are accepted by the type', () => {
    const stages: LastRun['currentStage'][] = [
      'research', 'assets', 'script', 'video', 'package', 'analyst', 'done', 'failed',
    ];
    const now = new Date().toISOString();

    for (const stage of stages) {
      mockWriteFileSync.mockClear();
      const run: LastRun = {
        timestamp: now,
        productsFound: 0,
        videosProduced: 0,
        errors: [],
        currentStage: stage,
        stageStartedAt: now,
      };
      writeLastRun(run);
      const written = JSON.parse(mockWriteFileSync.mock.calls[0]?.[1] as string) as LastRun;
      expect(written.currentStage).toBe(stage);
    }
  });
});

// ─── getRetryableProducts ─────────────────────────────────────────────────────

function makeQueuedProduct(
  overrides: Partial<QueuedProduct> & { status: QueuedProduct['status'] },
): QueuedProduct {
  return {
    id: 'p-state-test',
    productName: 'State Test Product',
    productUrl: 'https://example.com/p/1',
    tiktokShopId: 'shop-state-001',
    category: 'supplements',
    commissionRate: 10,
    shopPerformanceScore: 95,
    score: 75,
    scoreBreakdown: { salesVelocity: 30, shopPerformance: 20, videoEngagement: 15, assetAvailability: 10 },
    researchedAt: new Date().toISOString(),
    soldCount: 100,
    price: '$19.99',
    rating: 4.5,
    reviewCount: 200,
    sellerName: 'Seller',
    imageUrl: 'https://example.com/img.jpg',
    retryCount: 0,
    failHistory: [],
    ...overrides,
  };
}

function makeRecord(status: FailRecord['status'], error: string, attempt = 1): FailRecord {
  return { status, error, timestamp: new Date().toISOString(), attempt };
}

describe('getRetryableProducts — state module integration', () => {
  const NOW = new Date('2026-04-20T10:00:00.000Z');

  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when queue is empty', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));
    expect(getRetryableProducts(NOW)).toEqual([]);
  });

  it('returns assets_failed product with no lastRetryAt and < maxAttempts', () => {
    const p = makeQueuedProduct({
      status: 'assets_failed',
      failHistory: [makeRecord('assets_failed', 'Detail fetch failed: 503', 1)],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(p.id);
  });

  it('returns empty when product status is not a failed status', () => {
    const p = makeQueuedProduct({ status: 'queued' });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('excludes dead_letter products', () => {
    const p = makeQueuedProduct({ status: 'dead_letter' });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('applies per-stage cap correctly — assets max is 3', () => {
    const p = makeQueuedProduct({
      status: 'assets_failed',
      failHistory: [
        makeRecord('assets_failed', 'fail', 1),
        makeRecord('assets_failed', 'fail', 2),
        makeRecord('assets_failed', 'fail', 3), // at cap
      ],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('applies per-stage cap correctly — video max is 2', () => {
    const p = makeQueuedProduct({
      status: 'video_failed',
      failHistory: [
        makeRecord('video_failed', 'fail', 1),
        makeRecord('video_failed', 'fail', 2), // at cap
      ],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('structural failure on assets blocks retry', () => {
    const p = makeQueuedProduct({
      status: 'assets_failed',
      failHistory: [makeRecord('assets_failed', 'Insufficient images: 2/3', 1)],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('structural failure on video blocks retry', () => {
    const p = makeQueuedProduct({
      status: 'video_failed',
      failHistory: [makeRecord('video_failed', 'Input validation failed: bad script', 1)],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('cooldown blocks script_failed retry attempted 2 minutes ago', () => {
    const lastRetryAt = new Date(NOW.getTime() - 2 * 60 * 1000).toISOString();
    const p = makeQueuedProduct({
      status: 'script_failed',
      lastRetryAt,
      failHistory: [makeRecord('script_failed', 'Script generation failed: 503', 1)],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    expect(getRetryableProducts(NOW)).toHaveLength(0);
  });

  it('past cooldown permits script_failed retry attempted 10 minutes ago', () => {
    const lastRetryAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const p = makeQueuedProduct({
      status: 'script_failed',
      lastRetryAt,
      failHistory: [makeRecord('script_failed', 'Script generation failed: 503', 1)],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify([p]));
    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
  });
});
