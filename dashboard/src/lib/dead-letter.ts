/**
 * Dead-letter helpers for the dashboard API route.
 *
 * Logic mirrors src/shared/retry-policy.ts and src/shared/state.ts — kept
 * separate because the dashboard is an isolated Next.js package that cannot
 * import from the root src/ tree.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ─── Type definitions ─────────────────────────────────────────────────────────

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

export type FailedStatus = 'assets_failed' | 'script_failed' | 'video_failed';

export interface FailRecord {
  status: ProductStatus;
  error: string;
  timestamp: string;
  attempt: number;
}

export interface QueuedProduct {
  id: string;
  productName: string;
  tiktokShopId: string;
  category: string;
  status: ProductStatus;
  retryCount?: number;
  lastRetryAt?: string;
  failHistory?: FailRecord[];
  [key: string]: unknown;
}

export interface StagePolicy {
  retryableTo: ProductStatus;
  maxAttempts: number;
  structural: string[];
}

// ─── Policy table (mirrors src/shared/retry-policy.ts DEFAULT_STAGE_POLICIES) ─

export const STAGE_POLICIES: Readonly<Record<FailedStatus, StagePolicy>> = {
  assets_failed: {
    retryableTo: 'queued',
    maxAttempts: 3,
    structural: ['Insufficient images'],
  },
  script_failed: {
    retryableTo: 'assets_ready',
    maxAttempts: 3,
    structural: ['Asset manifest not found', 'Asset validation failed'],
  },
  video_failed: {
    retryableTo: 'script_ready',
    maxAttempts: 2,
    structural: [
      'ffmpeg not installed or not in PATH',
      'Missing manifest file on disk',
      'Missing script file on disk',
      'Input validation failed',
    ],
  },
} as const;

export const FAILED_STATUSES: FailedStatus[] = ['assets_failed', 'script_failed', 'video_failed'];

// ─── Filesystem helpers ───────────────────────────────────────────────────────

const STATE_DIR = resolve(process.cwd(), '..', 'state');

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function statePath(filename: string): string {
  ensureStateDir();
  return resolve(STATE_DIR, filename);
}

function readJson<T>(filename: string, fallback: T): T {
  const path = statePath(filename);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(filename: string, data: T): void {
  writeFileSync(statePath(filename), JSON.stringify(data, null, 2), 'utf-8');
}

export function readProductQueue(): QueuedProduct[] {
  return readJson<QueuedProduct[]>('product-queue.json', []);
}

export function writeProductQueue(products: QueuedProduct[]): void {
  writeJson('product-queue.json', products);
}

// ─── Dead-letter detection logic ──────────────────────────────────────────────

/**
 * Returns true when a product in a `*_failed` state has exhausted all automatic
 * retry attempts for its stage OR has a structural failure in its latest record.
 */
function isDeadLetter(product: QueuedProduct): boolean {
  const status = product.status as FailedStatus;
  if (!FAILED_STATUSES.includes(status)) return false;

  const policy = STAGE_POLICIES[status];
  const history = product.failHistory ?? [];

  // Per-stage attempt count
  const stageAttempts = history.filter((r) => r.status === status).length;
  if (stageAttempts >= policy.maxAttempts) return true;

  // Structural failure in the latest record for this stage
  const latestForStage = [...history].reverse().find((r) => r.status === status);
  if (
    latestForStage &&
    policy.structural.some((sig) => latestForStage.error.includes(sig))
  ) {
    return true;
  }

  return false;
}

// ─── Dead-letter entry shape returned by GET ──────────────────────────────────

export interface DeadLetterEntry {
  productId: string;
  category: string;
  name: string;
  recentFailures: FailRecord[];
  latestErrorReason: string;
}

/**
 * Reads the product queue and returns products that qualify as dead-letter:
 * - Status is one of `assets_failed`, `script_failed`, `video_failed`
 * - AND either retryCount >= maxAttempts for their stage OR structural failure detected
 */
export function getDeadLetterProducts(): DeadLetterEntry[] {
  const queue = readProductQueue();

  return queue
    .filter(isDeadLetter)
    .map((p): DeadLetterEntry => {
      const history = p.failHistory ?? [];
      const recentFailures = history.slice(-3);
      const latestErrorReason = recentFailures.at(-1)?.error ?? 'Unknown error';

      return {
        productId: p.id,
        category: p.category,
        name: p.productName,
        recentFailures,
        latestErrorReason,
      };
    });
}

// ─── Operator log helper ──────────────────────────────────────────────────────

interface OperatorLogEntry {
  timestamp: string;
  agent: string;
  level: 'info';
  message: string;
  productId: string;
  action: 'retry' | 'drop';
  operator: true;
}

function appendOperatorLog(entry: OperatorLogEntry): void {
  const path = statePath('errors.json');
  let existing: unknown[] = [];
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8')) as unknown[];
    } catch {
      existing = [];
    }
  }
  existing.push(entry);
  writeFileSync(path, JSON.stringify(existing, null, 2), 'utf-8');
}

// ─── Retry action ─────────────────────────────────────────────────────────────

export type RetryResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_failed_status' };

/**
 * Operator retry: resets the product to the stage's `retryableTo` state,
 * clears retryCount to 0, and logs the operator override.
 */
export function retryDeadLetterProduct(productId: string): RetryResult {
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.id === productId || p.tiktokShopId === productId);

  if (idx === -1) return { ok: false, reason: 'not_found' };

  const product = queue[idx]!;
  const status = product.status as FailedStatus;

  if (!FAILED_STATUSES.includes(status)) {
    return { ok: false, reason: 'not_failed_status' };
  }

  const policy = STAGE_POLICIES[status];

  queue[idx] = {
    ...product,
    status: policy.retryableTo,
    retryCount: 0,
    lastRetryAt: undefined,
  };

  writeProductQueue(queue);

  appendOperatorLog({
    timestamp: new Date().toISOString(),
    agent: 'dead-letter',
    level: 'info',
    message: `Operator retry override: product ${productId} reset from ${status} to ${policy.retryableTo}`,
    productId,
    action: 'retry',
    operator: true,
  });

  return { ok: true };
}

// ─── Drop action ──────────────────────────────────────────────────────────────

export type DropResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' };

/**
 * Operator drop: removes the product from the queue entirely and logs the
 * operator decision. The project uses no archived-products file (state-reader.ts
 * has no such pattern) so removal from queue is the correct choice.
 */
export function dropDeadLetterProduct(productId: string): DropResult {
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.id === productId || p.tiktokShopId === productId);

  if (idx === -1) return { ok: false, reason: 'not_found' };

  const product = queue[idx]!;
  const remaining = queue.filter((_, i) => i !== idx);

  writeProductQueue(remaining);

  appendOperatorLog({
    timestamp: new Date().toISOString(),
    agent: 'dead-letter',
    level: 'info',
    message: `Operator drop: product ${productId} (${String(product.productName)}) removed from queue`,
    productId,
    action: 'drop',
    operator: true,
  });

  return { ok: true };
}
