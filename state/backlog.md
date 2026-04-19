# TT_Auto — Backlog

Ordered within each bucket. "Phase" refers to `state/roadmap.md`. Items not yet scheduled live under *Unscheduled*. Route through Marcus.

---

## Phase A — Daily-Run Discipline

- [ ] **A1. Cron wrapper script.** `scripts/cron-run.sh`: invokes `npm run pipeline`, redirects stdout/stderr to `logs/YYYY-MM-DD.log`, respects `pipeline.lock`, exits non-zero on lock-held-by-live-PID so launchd/cron can retry. Add `pipeline.schedule` field to `config.json` (default `"02:00"` local). *Owner: Doug.*
- [ ] **A2. Stale-lock detection.** Edit `src/shared/lock.ts`: `acquireLock` checks lock age + PID liveness. If older than `pipeline.maxRunMinutes * 2` **and** PID is not running, reclaim + log to `errors.json` with agent `lock`. Add tests in `src/shared/__tests__/lock.test.ts` (new file) using fake PIDs. *Owner: Doug.*
- [ ] **A3. Per-stage heartbeat in `last-run.json`.** Extend `LastRun` type in `src/shared/types.ts` with `currentStage: 'research' | 'assets' | 'script' | 'video' | 'package' | 'analyst' | 'done' | 'failed'` and `stageStartedAt: string`. `run-pipeline.ts` calls `writeLastRun({...})` at the top of each step. On crash, `currentStage` reveals where. *Owner: Doug. Tony consults on the enum shape — 5 min review.*
- [ ] **A4. Dashboard run-health panel.** New component `dashboard/src/components/run-health.tsx`: shows last run timestamp, elapsed, current stage (live if lock held, final if not), success/fail counts. Add to `dashboard/src/app/page.tsx`. *Owner: Ava via `ui-ux-pro-max` — design-first.*

## Phase B — Retry Sweep + Dead-Letter Review

- [ ] **B0. Tony: retry policy contract.** Eligibility rules: which `*_failed` states are retryable, per-stage cooldowns, max attempts, transition back to prior `ready` state. Produces a short decision table Doug implements against. *Owner: Tony.*
- [ ] **B1. Failure sweep at pipeline start.** In `run-pipeline.ts` before Step 1: read queue, find `{assets_failed, script_failed, video_failed}` with `retryCount < 3` and `(now - lastRetryAt) > cooldown`. Reset status to prior-ready and bump `retryCount`. Log each reset to `errors.json` as info. *Owner: Doug.*
- [ ] **B2. Dead-letter API route.** `dashboard/src/app/api/dead-letter/route.ts` — `GET` lists dead-letter products, `POST {productId, action: 'retry'|'drop'}` mutates the queue. *Owner: Doug (API) + Elliot review (mutating route on state files).*
- [ ] **B3. Dead-letter dashboard view.** New component + tab/section. Shows productName, category, fail history (last 3), last error. Retry/Drop buttons wired to the API route. *Owner: Ava.*
- [ ] **B4. Consecutive-retry guard.** In B1, additionally skip if `lastRetryAt` is in the current run's startTime window. *Owner: Doug — roll into B1.*

## Phase C — Performance Loop Closure

- [ ] **C0. Tony: signal-to-weight mapping.** How does `AnalystSignals` translate into scoring-weight deltas? Draft the function signature + bounded adjustment rules (no runaway weights). *Owner: Tony.*
- [ ] **C1. Signal-weighted scoring in researcher.** `src/researcher/scorer.ts` consumes `analyst-signals.json` via a new `applySignalAdjustments(baseScore, product, signals)` function. Respects `highPerformingCategories`, `avoidCategories`, `minCommissionRateThreshold`. Tests in `src/researcher/__tests__/scorer.test.ts`. *Owner: Doug.*
- [ ] **C2. Hook pattern injection.** `src/scriptwriter/prompt-builder.ts` reads `winningHookPatterns` from signals and includes up to 3 as exemplars in the prompt. Bounded — don't blow up the prompt. *Owner: Doug.*
- [ ] **C3. Signal freshness guard.** In researcher: if `signals.updatedAt` > 14 days old OR posted video count < 3, log `[researcher] using neutral signal weights — stale or insufficient data` and use base weights. *Owner: Doug.*
- [ ] **C4. Dashboard signals panel.** Extend or replace `analyst-panel.tsx`: show current signals, last-analysis timestamp, contributing video count, which signals are actively influencing scoring right now. *Owner: Ava.*

## Phase D — Deferred-Items Triage

Each D item is a separate mini-project. Marcus triggers when worthwhile.

- [ ] **D1. TikTok Analytics ingest (replace manual `update-performance.ts`).** Blocked on: creator/business API credential. If blocked, stays manual.
- [ ] **D2. Auto-post gate.** Design a per-run confirmation gate (e.g., dashboard approval button flips a `state/approved-to-post.json` flag that the poster reads). *Tony designs first.*
- [ ] **D3. Kling/Runway primary path.** Video provider abstraction — `VideoGenerator` interface, slideshow as fallback, A/B quality sampling. *Tony designs first.*

## Phase E — Channel-2

Deferred until revenue milestone. No backlog items yet.

---

## Unscheduled / Tech Debt

- [ ] **TD1. Output directory cleanup.** `output/YYYY-MM-DD/` grows forever. Add a sweep that deletes folders older than N days (config: `content.outputRetentionDays`, default 30). After Phase A. *Owner: Doug.*
- [ ] **TD2. `state/errors.json` size discipline.** `trimErrors()` keeps 7 days (per Phase 5 of original plan). Verify it's actually being called — spot-check in `run-pipeline.ts` line 58 confirms it is. Keep an eye on file size in practice. *No action unless size becomes a problem.*
- [ ] **TD3. Config hot-reload.** Currently config is read at startup. For long-running dashboard dev, a change requires restart. Low priority.
- [ ] **TD4. Content-manager weekly-limit clock.** Verify the 5-per-week rolling window behaves correctly across week boundaries. Write a targeted test if not already covered. *Owner: Doug or Chris.*
- [ ] **TD5. Vitest matrix expansion.** 99 tests exist; not all modules have coverage (e.g., content-manager, analyst lack dedicated test files). Add when touching those files, not as a standalone sweep.

## Security Review Queue

- [ ] **SEC1. `.env` + API key handling.** Any new code path reading env vars → Elliot review. Current state: no new routes, not yet needed.
- [ ] **SEC2. Dashboard mutation routes.** When B2 lands, Elliot reviews before merge.

## Research / Open Questions

- [ ] **OQ1.** Is `Kling` actually intended as primary video generator, or is that aspirational config? Confirm before D3 design work.
- [ ] **OQ2.** What's the real-world hit rate on ScrapeCreators search quality? Is there a signal in the research-log suggesting we need a second source despite the plan excluding one?
- [ ] **OQ3.** Does the pilot-cap logic (5/week) correctly count across a calendar week boundary (Sun→Mon) vs. a rolling 7-day window? CLAUDE.md says "per week" — confirm which semantics shipped. *Related: TD4.*

---

## Done

### Phase A — Daily-Run Discipline
- **A1.** Cron wrapper script — `scripts/cron-run.sh` + `pipeline.schedule: "02:00"` in config.json + `logs/` dir + `.gitignore` entry — `feature/cron-wrapper` (2026-04-18). Lock contention delegated to Node's acquireLock (signal-0 PID check); wrapper propagates pipeline exit code. 99 Vitest tests still green.
