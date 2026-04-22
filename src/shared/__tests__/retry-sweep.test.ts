import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoist mock factories before any imports ─────────────────────────────────

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

import { getRetryableProducts } from '../state.js';
import type { QueuedProduct, FailRecord } from '../types.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeProduct(
  overrides: Partial<QueuedProduct> & { status: QueuedProduct['status'] },
): QueuedProduct {
  return {
    id: 'prod-001',
    productName: 'Test Product',
    productUrl: 'https://example.com/product/1',
    tiktokShopId: 'shop-001',
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
    sellerName: 'Test Seller',
    imageUrl: 'https://example.com/image.jpg',
    retryCount: 0,
    failHistory: [],
    ...overrides,
  };
}

function makeFailRecord(
  status: FailRecord['status'],
  error: string,
  attempt = 1,
): FailRecord {
  return {
    status,
    error,
    timestamp: new Date().toISOString(),
    attempt,
  };
}

function setupQueue(products: QueuedProduct[]): void {
  mockExistsSync.mockReturnValue(true);
  mockMkdirSync.mockReturnValue(undefined);
  mockReadFileSync.mockReturnValue(JSON.stringify(products));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getRetryableProducts', () => {
  const NOW = new Date('2026-04-20T12:00:00.000Z');

  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Within cooldown — product is skipped ─────────────────────────────────

  it('skips assets_failed product whose cooldown has not elapsed (30 min)', () => {
    // lastRetryAt = 15 minutes ago — within the 30-min cooldown
    const lastRetryAt = new Date(NOW.getTime() - 15 * 60 * 1000).toISOString();
    const product = makeProduct({
      status: 'assets_failed',
      lastRetryAt,
      failHistory: [makeFailRecord('assets_failed', 'Detail fetch failed: timeout', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips script_failed product whose cooldown has not elapsed (5 min)', () => {
    const lastRetryAt = new Date(NOW.getTime() - 2 * 60 * 1000).toISOString(); // 2 min ago
    const product = makeProduct({
      status: 'script_failed',
      lastRetryAt,
      failHistory: [makeFailRecord('script_failed', 'Script generation failed: 503', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed product whose cooldown has not elapsed (60 min)', () => {
    const lastRetryAt = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const product = makeProduct({
      status: 'video_failed',
      lastRetryAt,
      failHistory: [makeFailRecord('video_failed', 'Video production failed: ffmpeg error', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  // ── Past cooldown + under max — product is retried ───────────────────────

  it('returns assets_failed product past cooldown with attempt count below max', () => {
    const lastRetryAt = new Date(NOW.getTime() - 31 * 60 * 1000).toISOString(); // 31 min ago
    const product = makeProduct({
      status: 'assets_failed',
      retryCount: 1,
      lastRetryAt,
      failHistory: [makeFailRecord('assets_failed', 'Detail fetch failed: rate limit', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('prod-001');
  });

  it('returns script_failed product past cooldown with attempt count below max', () => {
    const lastRetryAt = new Date(NOW.getTime() - 6 * 60 * 1000).toISOString(); // 6 min ago
    const product = makeProduct({
      status: 'script_failed',
      retryCount: 1,
      lastRetryAt,
      failHistory: [makeFailRecord('script_failed', 'Script generation failed: parse error', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('prod-001');
  });

  it('returns video_failed product past cooldown with attempt count below max', () => {
    const lastRetryAt = new Date(NOW.getTime() - 61 * 60 * 1000).toISOString(); // 61 min ago
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 1,
      lastRetryAt,
      failHistory: [makeFailRecord('video_failed', 'Video production failed: ffmpeg error', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
  });

  it('returns product with no lastRetryAt (first ever failure — no cooldown applied)', () => {
    const product = makeProduct({
      status: 'assets_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('assets_failed', 'Detail fetch failed: 429', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
  });

  // ── retryCount verifies per-stage cap, not global ────────────────────────

  it('uses per-stage FailRecord count (not global retryCount) to enforce the cap', () => {
    // This product failed assets once and script twice — it's at max for script (3 attempts)
    // but assets cap is also 3 so assets_failed with 1 record should still be retryable
    const product = makeProduct({
      status: 'assets_failed',
      retryCount: 3, // global retryCount is 3, but per-stage assets cap is also 3
      lastRetryAt: undefined,
      failHistory: [
        makeFailRecord('assets_failed', 'Detail fetch failed: 429', 1), // only 1 assets_failed record
        makeFailRecord('script_failed', 'Script generation failed', 1),
        makeFailRecord('script_failed', 'Script generation failed', 2),
      ],
    });
    setupQueue([product]);

    // Per-stage: only 1 assets_failed record — max is 3 — should be retryable
    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
  });

  // ── At max attempts — stays failed ───────────────────────────────────────

  it('skips assets_failed product at max per-stage attempts (3 FailRecords)', () => {
    const product = makeProduct({
      status: 'assets_failed',
      retryCount: 3,
      lastRetryAt: undefined,
      failHistory: [
        makeFailRecord('assets_failed', 'Detail fetch failed: 429', 1),
        makeFailRecord('assets_failed', 'Detail fetch failed: 429', 2),
        makeFailRecord('assets_failed', 'Detail fetch failed: 429', 3),
      ],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed product at max per-stage attempts (2 FailRecords)', () => {
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 2,
      lastRetryAt: undefined,
      failHistory: [
        makeFailRecord('video_failed', 'Video production failed', 1),
        makeFailRecord('video_failed', 'Video production failed', 2),
      ],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  // ── Structural-failure — stays failed regardless of cooldown ─────────────

  it('skips assets_failed with "Insufficient images" regardless of cooldown elapsed', () => {
    const product = makeProduct({
      status: 'assets_failed',
      retryCount: 0,
      lastRetryAt: undefined, // no cooldown concern
      failHistory: [makeFailRecord('assets_failed', 'Insufficient images: 1/3', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips script_failed with "Asset manifest not found" structural signature', () => {
    const product = makeProduct({
      status: 'script_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('script_failed', 'Asset manifest not found', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips script_failed with "Asset validation failed" structural signature', () => {
    const product = makeProduct({
      status: 'script_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('script_failed', 'Asset validation failed: Only 1/3 images exist on disk', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed with "ffmpeg not installed or not in PATH" structural signature', () => {
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('video_failed', 'ffmpeg not installed or not in PATH', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed with "Missing manifest file on disk" structural signature', () => {
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('video_failed', 'Missing manifest file on disk for script_ready product', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed with "Missing script file on disk" structural signature', () => {
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('video_failed', 'Missing script file on disk for script_ready product', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  it('skips video_failed with "Input validation failed" structural signature', () => {
    const product = makeProduct({
      status: 'video_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('video_failed', 'Input validation failed: Script has no hook text', 1)],
    });
    setupQueue([product]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  // ── Non-failed statuses are never returned ───────────────────────────────

  it('ignores products in non-failed statuses', () => {
    const products: QueuedProduct[] = [
      makeProduct({ id: 'p1', status: 'queued' }),
      makeProduct({ id: 'p2', status: 'assets_ready' }),
      makeProduct({ id: 'p3', status: 'script_ready' }),
      makeProduct({ id: 'p4', status: 'video_ready' }),
      makeProduct({ id: 'p5', status: 'post_ready' }),
      makeProduct({ id: 'p6', status: 'posted' }),
      makeProduct({ id: 'p7', status: 'dead_letter' }),
    ];
    setupQueue(products);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(0);
  });

  // ── Mixed queue — only eligible products returned ────────────────────────

  it('returns only eligible products from a mixed queue', () => {
    const eligible = makeProduct({
      id: 'eligible',
      status: 'script_failed',
      retryCount: 0,
      lastRetryAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(), // 10 min ago > 5 min cooldown
      failHistory: [makeFailRecord('script_failed', 'Script generation failed: 503', 1)],
    });
    const withinCooldown = makeProduct({
      id: 'within-cooldown',
      status: 'assets_failed',
      retryCount: 0,
      lastRetryAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(), // 5 min ago < 30 min cooldown
      failHistory: [makeFailRecord('assets_failed', 'Detail fetch failed: 429', 1)],
    });
    const structural = makeProduct({
      id: 'structural',
      status: 'video_failed',
      retryCount: 0,
      lastRetryAt: undefined,
      failHistory: [makeFailRecord('video_failed', 'Input validation failed: missing hook', 1)],
    });
    const atMax = makeProduct({
      id: 'at-max',
      status: 'assets_failed',
      retryCount: 3,
      lastRetryAt: undefined,
      failHistory: [
        makeFailRecord('assets_failed', 'Detail fetch failed', 1),
        makeFailRecord('assets_failed', 'Detail fetch failed', 2),
        makeFailRecord('assets_failed', 'Detail fetch failed', 3),
      ],
    });

    setupQueue([eligible, withinCooldown, structural, atMax]);

    const result = getRetryableProducts(NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('eligible');
  });
});
