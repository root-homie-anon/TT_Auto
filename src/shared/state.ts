import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from './config.js';
import type {
  QueuedProduct,
  VideoQueueItem,
  PostedVideo,
  LastRun,
  PipelineError,
  ResearchLogEntry,
  AnalystSignals,
  ProductStatus,
} from './types.js';
import {
  RETRYABLE_STATUSES,
  resolvePolicy,
  isStructuralFailure,
  type FailedStatus,
  type RetryConfigOverrides,
} from './retry-policy.js';

const FAILED_STATUSES: ProductStatus[] = ['assets_failed', 'script_failed', 'video_failed'];

function statePath(filename: string): string {
  const dir = resolve(getProjectRoot(), 'state');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return resolve(dir, filename);
}

function readJson<T>(filename: string, fallback: T): T {
  const path = statePath(filename);
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as T;
}

function writeJson<T>(filename: string, data: T): void {
  writeFileSync(statePath(filename), JSON.stringify(data, null, 2), 'utf-8');
}

// Product queue
export function readProductQueue(): QueuedProduct[] {
  return readJson('product-queue.json', []);
}

export function writeProductQueue(products: QueuedProduct[]): void {
  writeJson('product-queue.json', products);
}

// Video queue
export function readVideoQueue(): VideoQueueItem[] {
  return readJson('video-queue.json', []);
}

export function writeVideoQueue(items: VideoQueueItem[]): void {
  writeJson('video-queue.json', items);
}

// Posted log
export function readPosted(): PostedVideo[] {
  return readJson('posted.json', []);
}

export function writePosted(posts: PostedVideo[]): void {
  writeJson('posted.json', posts);
}

// Research log
export function readResearchLog(): ResearchLogEntry[] {
  return readJson('research-log.json', []);
}

export function writeResearchLog(entries: ResearchLogEntry[]): void {
  writeJson('research-log.json', entries);
}

// Last run
export function readLastRun(): LastRun | null {
  return readJson<LastRun | null>('last-run.json', null);
}

export function writeLastRun(run: LastRun): void {
  writeJson('last-run.json', run);
}

// Errors
export function readErrors(): PipelineError[] {
  return readJson('errors.json', []);
}

export function appendError(error: PipelineError): void {
  const errors = readErrors();
  errors.push(error);
  writeJson('errors.json', errors);
}

const ERROR_RETENTION_DAYS = 7;

export function trimErrors(): void {
  const errors = readErrors();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ERROR_RETENTION_DAYS);
  const trimmed = errors.filter((e) => new Date(e.timestamp) > cutoff);
  if (trimmed.length < errors.length) {
    console.log(`[state] Trimmed ${errors.length - trimmed.length} errors older than ${ERROR_RETENTION_DAYS} days`);
    writeJson('errors.json', trimmed);
  }
}

// Product helpers
export function updateProduct(productId: string, update: Partial<QueuedProduct>): void {
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.id === productId || p.tiktokShopId === productId);
  if (idx === -1) return;
  Object.assign(queue[idx]!, update);
  writeProductQueue(queue);
}

/**
 * @deprecated Use {@link getRetryableProducts} instead. This function applies a
 * single global maxRetries cap and ignores per-stage cooldowns and structural-failure
 * filters defined in the retry-policy contract. It will be removed once all callers
 * have migrated.
 */
export function getFailedProducts(maxRetries: number = 3): QueuedProduct[] {
  const queue = readProductQueue();
  return queue.filter(
    (p) =>
      FAILED_STATUSES.includes(p.status) &&
      (p.retryCount ?? 0) < maxRetries,
  );
}

/**
 * Returns products eligible for automatic retry per the B0 retry-policy contract.
 *
 * A product is retryable if ALL of the following hold:
 * 1. Its status is one of `assets_failed`, `script_failed`, or `video_failed`.
 * 2. The count of FailRecord entries whose `status` matches the current failed status
 *    is strictly less than the per-stage `maxAttempts` cap (per-stage, not global).
 * 3. The cooldown has elapsed: `now - lastRetryAt >= cooldownMinutes` for the stage.
 *    Products with no `lastRetryAt` are always eligible (never retried before).
 * 4. The latest FailRecord does not contain a structural-failure substring for the stage
 *    (those go to dead_letter, not retried).
 *
 * Config overrides via `config.json` `retry` block take precedence over policy defaults.
 */
export function getRetryableProducts(now: Date, overrides?: RetryConfigOverrides): QueuedProduct[] {
  const queue = readProductQueue();
  const retryable: QueuedProduct[] = [];

  for (const product of queue) {
    if (!RETRYABLE_STATUSES.includes(product.status as FailedStatus)) continue;

    const failedStatus = product.status as FailedStatus;
    const policy = resolvePolicy(failedStatus, overrides);
    const history = product.failHistory ?? [];

    // Per-stage attempt count: only records matching the current failed status
    const stageAttempts = history.filter((r) => r.status === failedStatus).length;
    if (stageAttempts >= policy.maxAttempts) continue;

    // Structural-failure check against the latest FailRecord for this stage
    const latestForStage = [...history].reverse().find((r) => r.status === failedStatus);
    if (latestForStage && isStructuralFailure(failedStatus, latestForStage.error)) continue;

    // Cooldown check
    if (product.lastRetryAt) {
      const lastRetry = new Date(product.lastRetryAt).getTime();
      const cooldownMs = policy.cooldownMinutes * 60 * 1000;
      if (now.getTime() - lastRetry < cooldownMs) continue;
    }

    retryable.push(product);
  }

  return retryable;
}

// Analyst signals
export function readAnalystSignals(): AnalystSignals | null {
  return readJson<AnalystSignals | null>('analyst-signals.json', null);
}

export function writeAnalystSignals(signals: AnalystSignals): void {
  writeJson('analyst-signals.json', signals);
}
