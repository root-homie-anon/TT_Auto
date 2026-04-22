/**
 * Per-stage retry policy constants — source of truth is the decision table in
 * docs/architecture/retry-policy.md §2, structural-failure patterns in §6.
 *
 * Config overrides: config.json `retry.maxAttempts.{assets,script,video}` and
 * `retry.cooldownMinutes.{assets,script,video}` take precedence over these
 * defaults when present.
 */

import type { ProductStatus } from './types.js';

export interface StagePolicy {
  /** The status the product is reset to when retried. */
  retryableTo: ProductStatus;
  /** Maximum number of FailRecord entries with the current failed status before dead_letter. */
  maxAttempts: number;
  /** Minimum wall-clock minutes between retries (per-product). */
  cooldownMinutes: number;
  /**
   * Substrings that, when present in the latest FailRecord.error, mark the failure
   * as structurally non-retryable — send straight to dead_letter, no attempt consumed.
   * Special sentinel: 'ffmpeg not installed or not in PATH' triggers a stage-wide
   * halt (logged + sweep exits early) rather than a per-product dead_letter.
   */
  structural: string[];
}

/** The failed status that triggers a stage-wide halt instead of per-product dead_letter. */
export const FFMPEG_HALT_SUBSTRING = 'ffmpeg not installed or not in PATH';

/**
 * Default per-stage policy values from the decision table in §2 / §6.
 * These are overridden by config.json `retry` block at runtime via `resolvePolicy`.
 */
export const DEFAULT_STAGE_POLICIES: Readonly<Record<'assets_failed' | 'script_failed' | 'video_failed', StagePolicy>> = {
  assets_failed: {
    retryableTo: 'queued',
    maxAttempts: 3,
    cooldownMinutes: 30,
    structural: ['Insufficient images'],
  },
  script_failed: {
    retryableTo: 'assets_ready',
    maxAttempts: 3,
    cooldownMinutes: 5,
    structural: ['Asset manifest not found', 'Asset validation failed'],
  },
  video_failed: {
    retryableTo: 'script_ready',
    maxAttempts: 2,
    cooldownMinutes: 60,
    structural: [
      FFMPEG_HALT_SUBSTRING,
      'Missing manifest file on disk',
      'Missing script file on disk',
      'Input validation failed',
    ],
  },
} as const;

export type FailedStatus = keyof typeof DEFAULT_STAGE_POLICIES;
export const RETRYABLE_STATUSES = Object.keys(DEFAULT_STAGE_POLICIES) as FailedStatus[];

export interface RetryConfigOverrides {
  maxAttempts?: {
    assets?: number;
    script?: number;
    video?: number;
  };
  cooldownMinutes?: {
    assets?: number;
    script?: number;
    video?: number;
  };
}

/**
 * Returns the resolved policy for the given failed status, merging config overrides
 * on top of the defaults from the decision table.
 */
export function resolvePolicy(
  status: FailedStatus,
  overrides?: RetryConfigOverrides,
): StagePolicy {
  const base = DEFAULT_STAGE_POLICIES[status];
  if (!overrides) return base;

  const stageKey = status === 'assets_failed' ? 'assets' : status === 'script_failed' ? 'script' : 'video';
  const maxAttempts = overrides.maxAttempts?.[stageKey] ?? base.maxAttempts;
  const cooldownMinutes = overrides.cooldownMinutes?.[stageKey] ?? base.cooldownMinutes;

  return { ...base, maxAttempts, cooldownMinutes };
}

/**
 * Returns true if the given error string contains a structural-failure substring
 * for the given stage, meaning the product should go straight to dead_letter.
 */
export function isStructuralFailure(status: FailedStatus, errorString: string): boolean {
  return DEFAULT_STAGE_POLICIES[status].structural.some((sig) => errorString.includes(sig));
}
