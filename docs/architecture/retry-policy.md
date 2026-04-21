# Retry Policy Contract

**Status:** Approved design (Tony) — implemented by Doug in B1.
**Scope:** `QueuedProduct.status` lifecycle in `state/product-queue.json`. Research stage is not retried (no `research_failed` state — research emits products at `queued` or drops them pre-queue).

---

## 1. State Map

All states on `ProductStatus` (`src/shared/types.ts:9-19`), grouped by pipeline stage.

| Stage    | Entry state   | Success → next     | Failure state     |
|----------|---------------|--------------------|-------------------|
| research | (pre-queue)   | `queued`           | (not queued; logged to research-log) |
| assets   | `queued`      | `assets_ready`     | `assets_failed`   |
| script   | `assets_ready`| `script_ready`     | `script_failed`   |
| video    | `script_ready`| `video_ready`      | `video_failed`    |
| package  | `video_ready` | `post_ready`       | (no failed state — skipped on limit/missing video; no status change) |
| analyst  | `posted`      | (signals updated)  | (no per-product state) |
| terminal | —             | `posted`, `dead_letter` | —             |

Retryable `*_failed` states: `assets_failed`, `script_failed`, `video_failed`. These are the only three the retry runner acts on.

---

## 2. Decision Table

One row per `*_failed` state. `transitions-to` is the prior `*_ready` state the retry runner writes before re-invoking the stage.

| from-state       | retryable? | transitions-to-on-retry | max attempts | cooldown (min) | rationale |
|------------------|-----------|-------------------------|--------------|----------------|-----------|
| `assets_failed`  | yes       | `queued`                | 3            | 30             | Usually ScrapeCreators/TikTok Shop transient (rate limit, flaky upstream); cooldown lets upstream recover. |
| `script_failed`  | yes*      | `assets_ready`          | 3            | 5              | Usually LLM JSON parse / transient API hiccup. Fast retry is cheap and usually succeeds. See §6 for structural sub-case. |
| `video_failed`   | yes*      | `script_ready`          | 2            | 60             | Video providers backoff hard and ffmpeg failures are expensive to re-run. See §6 for ffmpeg-missing sub-case. |

`yes*` = retryable **only if** the failure is not one of the structurally-non-retryable sub-cases listed in §6. The retry runner inspects the latest `FailRecord.error` string to distinguish.

On max-attempts exceeded: product transitions to `dead_letter`. See §5.

---

## 3. Cooldown Rationale

Cooldown is the minimum wall-clock minutes between `lastRetryAt` and the next retry attempt for a given product.

- **Assets — 30 min.** Asset failures are dominated by external calls to ScrapeCreators/TikTok Shop. When one fails, nearby requests usually fail too (rate limit, IP block, upstream outage). 30 minutes is long enough to clear a typical rate-limit window and short enough that the product isn't stale. Matches typical TikTok Shop scraping cooldown practice.
- **Script — 5 min.** Script failures are almost always the Anthropic call: transient 5xx, overload, or a JSON-parse error on a one-off bad completion. Re-running is cheap (one LLM call), upstream recovers in seconds, and the product is time-sensitive. 5 minutes is enough to skip a transient overload without blocking the pipeline.
- **Video — 60 min.** Video generation is the most expensive leg (ffmpeg, TTS, possibly Kling/Runway). Failures often reflect provider-side backoff or local resource pressure. A 60-minute cooldown prevents hammering an already-struggling provider and gives local disk/CPU time to recover.

Cooldowns are **per-product**, not per-stage-global. Two different products failing at the same stage are independent.

---

## 4. Retry Counter Semantics

- `retryCount: number` — total auto-retry attempts across all stages for this product. Starts at `0` (or undefined, treated as 0).
- `lastRetryAt: string` (ISO) — timestamp of the most recent retry attempt write.
- `failHistory: FailRecord[]` — append-only log of every failure, including status, error message, timestamp, and attempt number at time of failure.

**Increment rule.** `retryCount` is incremented by **one** at the moment the retry runner transitions a `*_failed` product back to its prior `*_ready` state — *before* the stage is re-invoked. This counts the attempt, not the outcome.

**Reset rule.** `retryCount` resets to `0` when the product reaches `post_ready` (the first terminal-success state). It does **not** reset on intermediate success (e.g. re-passing assets after an asset retry does not reset the counter, because downstream may still fail and we need the global budget).

**Max attempts interpretation.** `max attempts` in §2 is the **per-stage** cap, compared against the count of `FailRecord` entries whose `status` matches the current failed state. Example: a product with `failHistory` showing 3 `assets_failed` records has hit the assets cap and must go to `dead_letter` even if `retryCount` across all stages is higher. This prevents one cheap stage from starving the budget of another.

**B4 consecutive-retry guard.** B4 introduces a "same-run retry" guard: within a single pipeline run, a product that fails stage X must not be auto-retried in that same run. The retry runner is a separate entry point invoked on subsequent runs (cron or manual) — not inline inside `run-pipeline.ts`. `retryCount` increments across runs; `lastRetryAt` + cooldown enforces spacing within a run.

---

## 5. Escalation Path

When a product exceeds max attempts for its current failed stage, the retry runner writes `status = 'dead_letter'` and appends a final `FailRecord` with `error: 'max_attempts_exceeded:<stage>'`.

- **Dead-letter products are never auto-retried.** The retry runner filters them out.
- **Operator action required.** The B2/B3 dashboard surfaces dead-letter products with their `failHistory` so the operator can decide:
  1. **Manual retry** — operator resets `retryCount = 0`, clears `lastRetryAt`, and sets `status` back to the appropriate `*_ready` prior state. Dashboard action, not a code path the retry runner reaches.
  2. **Drop** — operator leaves in `dead_letter`. Product is excluded from pipeline queries and aged out of the queue by a separate retention job (out of scope for B1).
- **No silent drops.** A product never leaves `dead_letter` automatically. Only operator action.

---

## 6. Non-Retryable Failures

Some failures are structural — retrying cannot succeed. The retry runner must pattern-match the latest `FailRecord.error` and route these straight to `dead_letter` without consuming a retry attempt.

| Stage    | Non-retryable signature (substring in FailRecord.error)        | Reason |
|----------|-----------------------------------------------------------------|--------|
| assets   | `Insufficient images`                                           | Product listing structurally lacks required assets; re-scraping won't add images. |
| script   | `Asset manifest not found`                                      | Manifest file missing on disk — upstream state is corrupt, not a transient LLM issue. Needs operator triage. |
| script   | `Asset validation failed`                                       | Manifest exists but is structurally invalid (missing benefits, bad shape). Retrying the LLM won't fix upstream data. |
| video    | `ffmpeg not installed or not in PATH`                           | Environmental, not per-product. Must halt entire video stage, not dead-letter one product. Retry runner logs and exits without touching the queue. |
| video    | `Missing manifest file on disk` / `Missing script file on disk` | Upstream state corrupt. Operator triage. |
| video    | `Input validation failed`                                       | Script/manifest structurally wrong for video generation. LLM rewrite needed, not a blind retry. |
| any      | future: `compliance-flag:*`                                     | Reserved. Once a compliance agent exists, any `compliance-flag:*` error is terminal — never auto-retry content-policy failures. |

Compliance is called out explicitly because it is the class of failure most dangerous to auto-retry: silently retrying a compliance-flagged product could publish policy-violating content. **Default deny** for any future `compliance-flag:*` error string.

---

## 7. Open Questions for B1 Implementation

- **Cooldown clock source.** Use `Date.now()` against `lastRetryAt`. No timezone handling needed — ISO UTC throughout.
- **Retry runner invocation.** Assumed to be a separate script (`scripts/run-retries.ts`) invoked by cron between full-pipeline runs, and optionally inline at the start of `run-pipeline.ts` before the research step. Doug decides the wiring; the contract above is agnostic.
- **Concurrency.** The existing `acquireLock('pipeline')` mechanism (`src/shared/lock.ts`) must also cover the retry runner. Retry runner acquires the same lock to prevent races with a live pipeline run.
- **Config overrides.** Max attempts and cooldowns should be tunable via `config.json` under a new `retry` block, falling back to the table in §2 as defaults. Schema: `retry.maxAttempts.{assets,script,video}` and `retry.cooldownMinutes.{assets,script,video}`.

---

## 8. Handoff to Doug (B1)

Build against:
- Decision table in §2 as the source of truth for eligibility, transitions, caps, and cooldowns.
- Counter semantics in §4 for `retryCount` / `lastRetryAt` / `failHistory` writes.
- Structural-failure pattern match in §6 for non-retryable routing.
- Escalation in §5 for `dead_letter` writes.

Watch out for:
- `getFailedProducts()` in `src/shared/state.ts:114` already exists but uses a single `maxRetries` arg and compares against `retryCount`. It needs to be replaced (or a new function added) that applies **per-stage** caps from the decision table, **per-stage cooldowns**, and the structural-failure filter. Do not reuse the single-cap path.
- `FailRecord.attempt` field must be written at failure time, not at retry time, so the count matches the retry runner's view of history.
- ffmpeg-missing is a stage-wide halt, not a per-product dead-letter — implement as an early-exit in the retry runner before touching any queue entries.
