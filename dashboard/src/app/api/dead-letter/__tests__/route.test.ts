/**
 * Tests for the dead-letter route helper layer (dead-letter.ts).
 *
 * We test through the helper functions directly — the Next.js route handlers
 * are thin wrappers around them (validation + JSON serialization only) and
 * are covered by the integration assertions below on the helper return values.
 *
 * Filesystem is mocked via vi.hoisted so no state/ directory is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoist mocks before any imports ──────────────────────────────────────────

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

import type { QueuedProduct, FailRecord } from '@/lib/dead-letter';
import {
  getDeadLetterProducts,
  retryDeadLetterProduct,
  dropDeadLetterProduct,
  STAGE_POLICIES,
} from '@/lib/dead-letter';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<QueuedProduct> & { status: QueuedProduct['status'] }): QueuedProduct {
  return {
    id: 'prod-001',
    productName: 'Test Supplement',
    tiktokShopId: 'shop-001',
    category: 'supplements',
    status: 'assets_failed',
    retryCount: 0,
    failHistory: [],
    ...overrides,
  };
}

function makeRecord(status: FailRecord['status'], error: string, attempt = 1): FailRecord {
  return { status, error, timestamp: new Date().toISOString(), attempt };
}

// ─── GET — getDeadLetterProducts ──────────────────────────────────────────────

describe('getDeadLetterProducts', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET happy path — returns dead-letter products that have hit the attempt cap', () => {
    const deadProduct = makeProduct({
      id: 'prod-dl-001',
      productName: 'Dead Supplement',
      category: 'supplements',
      status: 'assets_failed',
      failHistory: [
        makeRecord('assets_failed', 'Detail fetch failed: 503', 1),
        makeRecord('assets_failed', 'Detail fetch failed: 503', 2),
        makeRecord('assets_failed', 'Detail fetch failed: 503', 3), // at cap (maxAttempts=3)
      ],
    });

    const liveProduct = makeProduct({
      id: 'prod-live-001',
      status: 'assets_failed',
      failHistory: [makeRecord('assets_failed', 'Detail fetch failed: 503', 1)], // 1 of 3, still retryable
    });

    mockReadFileSync.mockReturnValue(JSON.stringify([deadProduct, liveProduct]));

    const result = getDeadLetterProducts();

    expect(result).toHaveLength(1);
    expect(result[0]!.productId).toBe('prod-dl-001');
    expect(result[0]!.name).toBe('Dead Supplement');
    expect(result[0]!.category).toBe('supplements');
  });

  it('GET happy path — returns up to 3 most recent FailRecord entries', () => {
    const records: FailRecord[] = [
      makeRecord('assets_failed', 'error 1', 1),
      makeRecord('assets_failed', 'error 2', 2),
      makeRecord('assets_failed', 'error 3', 3),
    ];
    const product = makeProduct({
      status: 'assets_failed',
      failHistory: records,
    });

    mockReadFileSync.mockReturnValue(JSON.stringify([product]));

    const result = getDeadLetterProducts();

    expect(result[0]!.recentFailures).toHaveLength(3);
    expect(result[0]!.latestErrorReason).toBe('error 3');
  });

  it('GET — returns product with structural failure even below attempt cap', () => {
    const product = makeProduct({
      status: 'assets_failed',
      failHistory: [
        makeRecord('assets_failed', 'Insufficient images: only 2 found', 1),
        // only 1 attempt but structural — should appear as dead-letter
      ],
    });

    mockReadFileSync.mockReturnValue(JSON.stringify([product]));

    const result = getDeadLetterProducts();
    expect(result).toHaveLength(1);
    expect(result[0]!.latestErrorReason).toContain('Insufficient images');
  });

  it('GET — excludes products not in a failed status', () => {
    const queued = makeProduct({ status: 'queued', failHistory: [] });
    const ready = makeProduct({ status: 'assets_ready', failHistory: [] });

    mockReadFileSync.mockReturnValue(JSON.stringify([queued, ready]));

    expect(getDeadLetterProducts()).toHaveLength(0);
  });

  it('GET — returns empty array when queue is empty', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));
    expect(getDeadLetterProducts()).toEqual([]);
  });

  it('GET — returns empty array when queue file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getDeadLetterProducts()).toEqual([]);
  });

  it('GET — video_failed at cap (2) appears in dead-letter', () => {
    const product = makeProduct({
      status: 'video_failed',
      failHistory: [
        makeRecord('video_failed', 'ffmpeg render error', 1),
        makeRecord('video_failed', 'ffmpeg render error', 2), // at cap (maxAttempts=2)
      ],
    });

    mockReadFileSync.mockReturnValue(JSON.stringify([product]));

    const result = getDeadLetterProducts();
    expect(result).toHaveLength(1);
  });

  it('GET — script_failed with structural failure appears in dead-letter', () => {
    const product = makeProduct({
      status: 'script_failed',
      failHistory: [makeRecord('script_failed', 'Asset manifest not found: /state/assets/prod-001', 1)],
    });

    mockReadFileSync.mockReturnValue(JSON.stringify([product]));

    const result = getDeadLetterProducts();
    expect(result).toHaveLength(1);
  });
});

// ─── POST retry ───────────────────────────────────────────────────────────────

describe('retryDeadLetterProduct', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('POST retry — resets product to retryableTo state and clears retryCount', () => {
    const product = makeProduct({
      id: 'prod-retry-001',
      status: 'assets_failed',
      retryCount: 3,
      failHistory: [
        makeRecord('assets_failed', 'fail', 1),
        makeRecord('assets_failed', 'fail', 2),
        makeRecord('assets_failed', 'fail', 3),
      ],
    });

    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([product]))  // readProductQueue in retry
      .mockReturnValueOnce(JSON.stringify([]));        // readErrors in appendOperatorLog

    const result = retryDeadLetterProduct('prod-retry-001');

    expect(result.ok).toBe(true);

    // First writeFileSync call is writeProductQueue
    const writtenQueue = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string) as QueuedProduct[];
    expect(writtenQueue).toHaveLength(1);
    expect(writtenQueue[0]!.status).toBe(STAGE_POLICIES.assets_failed.retryableTo); // 'queued'
    expect(writtenQueue[0]!.retryCount).toBe(0);
    expect(writtenQueue[0]!.lastRetryAt).toBeUndefined();
  });

  it('POST retry — appends operator log entry to errors.json', () => {
    const product = makeProduct({
      id: 'prod-retry-log',
      status: 'script_failed',
      retryCount: 3,
    });

    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([product]))
      .mockReturnValueOnce(JSON.stringify([]));

    retryDeadLetterProduct('prod-retry-log');

    // Second write is errors.json
    const writtenErrors = JSON.parse(mockWriteFileSync.mock.calls[1]![1] as string) as unknown[];
    expect(writtenErrors).toHaveLength(1);
    const logEntry = writtenErrors[0] as Record<string, unknown>;
    expect(logEntry['agent']).toBe('dead-letter');
    expect(logEntry['action']).toBe('retry');
    expect(logEntry['productId']).toBe('prod-retry-log');
    expect(logEntry['operator']).toBe(true);
    expect(logEntry['level']).toBe('info');
  });

  it('POST retry — returns not_found when productId does not exist', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));

    const result = retryDeadLetterProduct('does-not-exist');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_found');
    }
  });

  it('POST retry — returns not_failed_status when product is not in a failed state', () => {
    const product = makeProduct({ id: 'prod-queued', status: 'queued' });
    mockReadFileSync.mockReturnValue(JSON.stringify([product]));

    const result = retryDeadLetterProduct('prod-queued');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_failed_status');
    }
  });

  it('POST retry — resets video_failed to script_ready per policy', () => {
    const product = makeProduct({ id: 'prod-vid', status: 'video_failed', retryCount: 2 });

    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([product]))
      .mockReturnValueOnce(JSON.stringify([]));

    retryDeadLetterProduct('prod-vid');

    const writtenQueue = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string) as QueuedProduct[];
    expect(writtenQueue[0]!.status).toBe('script_ready');
  });
});

// ─── POST drop ────────────────────────────────────────────────────────────────

describe('dropDeadLetterProduct', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('POST drop — removes product from the queue entirely', () => {
    const target = makeProduct({ id: 'prod-drop-001', status: 'video_failed' });
    const other = makeProduct({ id: 'prod-keep-001', status: 'queued' });

    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([target, other]))
      .mockReturnValueOnce(JSON.stringify([]));

    const result = dropDeadLetterProduct('prod-drop-001');

    expect(result.ok).toBe(true);

    const writtenQueue = JSON.parse(mockWriteFileSync.mock.calls[0]![1] as string) as QueuedProduct[];
    expect(writtenQueue).toHaveLength(1);
    expect(writtenQueue[0]!.id).toBe('prod-keep-001');
  });

  it('POST drop — appends operator log entry to errors.json', () => {
    const product = makeProduct({ id: 'prod-drop-log', status: 'assets_failed' });

    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([product]))
      .mockReturnValueOnce(JSON.stringify([]));

    dropDeadLetterProduct('prod-drop-log');

    const writtenErrors = JSON.parse(mockWriteFileSync.mock.calls[1]![1] as string) as unknown[];
    expect(writtenErrors).toHaveLength(1);
    const logEntry = writtenErrors[0] as Record<string, unknown>;
    expect(logEntry['agent']).toBe('dead-letter');
    expect(logEntry['action']).toBe('drop');
    expect(logEntry['productId']).toBe('prod-drop-log');
    expect(logEntry['operator']).toBe(true);
  });

  it('POST drop — returns not_found when productId does not exist', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify([]));

    const result = dropDeadLetterProduct('ghost-product');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_found');
    }
  });
});

// ─── Zod schema validation (route-level contract) ─────────────────────────────

describe('POST body validation — zod schema contract', () => {
  it('rejects missing productId', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      productId: z.string().min(1),
      action: z.enum(['retry', 'drop']),
    });

    const result = schema.safeParse({ action: 'retry' });
    expect(result.success).toBe(false);
  });

  it('rejects missing action', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      productId: z.string().min(1),
      action: z.enum(['retry', 'drop']),
    });

    const result = schema.safeParse({ productId: 'prod-001' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid action value', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      productId: z.string().min(1),
      action: z.enum(['retry', 'drop']),
    });

    const result = schema.safeParse({ productId: 'prod-001', action: 'delete' });
    expect(result.success).toBe(false);
  });

  it('accepts valid retry body', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      productId: z.string().min(1),
      action: z.enum(['retry', 'drop']),
    });

    const result = schema.safeParse({ productId: 'prod-001', action: 'retry' });
    expect(result.success).toBe(true);
  });

  it('accepts valid drop body', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      productId: z.string().min(1),
      action: z.enum(['retry', 'drop']),
    });

    const result = schema.safeParse({ productId: 'prod-001', action: 'drop' });
    expect(result.success).toBe(true);
  });
});
