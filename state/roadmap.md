# TT_Auto — Roadmap

## Framing
The phased build plan (`docs/architecture/phased-build-plan.md`) is **complete**. All five phases shipped plus error recovery, locking, and pilot captions. The pipeline runs end-to-end and has test coverage.

What follows is the *next* arc: go from "it works when I run it" to "it runs itself reliably and I can see what happened without grepping logs," then tackle the deferred items from the original plan when each becomes worth its complexity.

Phases below are sequential unless marked parallel. Each is sized for one focused session unless noted.

---

## Phase A — Daily-Run Discipline (current)

**Goal:** The pipeline runs unattended on a schedule, surfaces its own health, and never silently stalls.

Why first: Everything upstream is solved. The last piece of "it works" is removing the human from the trigger.

**Tasks:**
1. **Scheduled runs.** Cron wrapper (`scripts/cron-run.sh`) that invokes `npm run pipeline`, captures stdout/stderr to dated log, respects `pipeline.lock`, and no-ops if a previous run is still holding the lock. Daily at a configurable time in `config.json` (`pipeline.schedule`).
2. **Stale-lock detection.** Current `acquireLock` blocks but doesn't age out. If `pipeline.lock` is older than 2× expected run duration and the PID is dead, reclaim it with a warning to `errors.json`. (Edit `src/shared/lock.ts`.)
3. **Run health heartbeat.** Each pipeline step writes a stage marker to `state/last-run.json` (not just the final summary). On crash, the file shows where it died. Small change to `run-pipeline.ts`.
4. **Dashboard: run-health panel.** Surface last-run, current lock state, and step-by-step progress (from the heartbeat). Ava via `ui-ux-pro-max`.

**Owner:** Doug (backend: 1–3) + Ava (dashboard: 4). Tony consulted only if step 3's heartbeat shape needs discussion.
**Scope:** 1 session backend + 1 session dashboard (can run parallel).

---

## Phase B — Retry-From-Previous-Run + Dead-Letter Review

**Goal:** Nothing stays stuck. Products in `*_failed` get another chance next run; `dead_letter` items surface in the dashboard for manual triage.

Why second: Error recovery exists in-run (commit `e2fa9fd`) but doesn't sweep old failures. With scheduled runs from Phase A, transient failures shouldn't require manual re-triggering.

**Tasks:**
1. **Failure sweep at pipeline start.** Before Step 1, scan `product-queue.json` for `*_failed` items with `retryCount < N`, eligible by age (e.g. 1h cooldown). Reset to the prior-stage status and let the pipeline reprocess them. Max retries = 3, then `dead_letter`.
2. **Dead-letter dashboard view.** List, with last error + fail history. One-click "retry anyway" and "drop" actions (via a small API route in `dashboard/src/app/api/`).
3. **Backoff sanity.** Don't retry the same product in two consecutive runs — add `lastRetryAt` check.

**Owner:** Doug (1, 3) + Ava (2). Tony drafts the retry policy contract — the eligibility rules and the state-transition table — before Doug codes it.
**Scope:** 1 session. Depends on Phase A for scheduled firing to matter.

---

## Phase C — Performance Loop Closure

**Goal:** Analyst signals actually influence the next day's research, measurably.

Why third: `generateSignals()` runs, but signals currently feed into scoring weakly. With scheduled runs + retry sweep in place, the feedback loop is the highest-leverage remaining improvement to content quality.

**Tasks:**
1. **Signal-weighted scoring.** Researcher reads `analyst-signals.json` and adjusts category/format weights — e.g., boost `highPerformingCategories`, penalize `avoidCategories`, skip below `minCommissionRateThreshold`. Today these fields exist but aren't consumed.
2. **Hook pattern reuse.** Scriptwriter prompt injects `winningHookPatterns` from signals as exemplars.
3. **Signal freshness guard.** If signals are >14 days old (low posted-video count), fall back to neutral weights + log a notice.
4. **Dashboard: signals panel.** Show current signals, date of last analysis, N posted videos contributing.

**Owner:** Tony drafts the scoring-adjustment contract (how signals map to weight deltas — this is architectural, not mechanical). Doug implements 1–3. Ava implements 4.
**Scope:** 1–2 sessions.

---

## Phase D — Deferred-Items Triage

Three items from the original plan's "What This Plan Does NOT Include" list. Each unlocks only when the prerequisite is met. These are *opt-in*, not sequenced — pick the one that blocks daily ops next.

**D1 — TikTok Analytics ingest.** Replace manual `update-performance.ts` with scheduled pull. Requires: TikTok Creator/Business API access (credential, not always available). If access is blocked, stay manual.

**D2 — Auto-post to TikTok.** Flip `features.autoPost`. Requires: stable daily run (Phase A done), confidence in content quality (Phase C done), TikTok posting API or `repurpose.io`. Risk: a bad video auto-posting is worse than no post. Keep behind a per-run confirmation gate initially.

**D3 — Real AI video (Kling/Runway).** FFmpeg slideshow works; Kling was configured but never wired as primary. Requires: budget/API key confirmed, quality A/B framework so slideshow stays as fallback. Non-trivial — Tony designs the provider abstraction before Doug codes.

**Owner:** Each is a separate mini-project. Tony sizes + designs first, then routes.
**Scope:** 1–3 sessions each.

---

## Phase E — Channel-2 Readiness

**Goal:** Prove the template scales. Second channel (beauty niche per CLAUDE.md "Scale Roadmap") should stand up in hours, not days.

**Trigger:** Channel 1 generating consistent affiliate revenue (per CLAUDE.md milestone).

**Tasks (not sized until triggered):**
1. Extract channel-specific config (`brand-guidelines.md`, `product-categories.md`, `hook-formulas.md`, config.json) into a per-channel folder.
2. Multi-channel state paths (`state/health-is-wealth/...`, `state/beauty/...`).
3. Multi-channel pipeline runner that iterates channels.
4. Dashboard: channel switcher.

**Scope:** Deferred. Design-only when triggered.

---

## Dependency Graph

```
Phase A (daily-run discipline)
    │
Phase B (retry sweep) ──── Phase C (signal-weighted scoring)
    │                              │
    └──────────── Phase D (deferred items, pick as needed)
                              │
                         Phase E (channel-2) — triggered by revenue
```

A is the gate. B and C can run in parallel once A lands (different files, different owners). D items are independent of each other. E is gated on the business milestone, not engineering.

---

## What's NOT on this roadmap
- Rewriting the phased build plan's output — it's correct and shipped
- Swapping filesystem state for Postgres — user's "build local" preference is already satisfied; adding a DB for a single-operator CLI is complexity without payoff
- Test coverage expansion as a standalone phase — tests written alongside each phase, per the original plan's stance
- Multi-channel work before the revenue milestone — premature abstraction
