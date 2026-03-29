# TT_Auto Phased Build Plan

## Current State

The pipeline works end-to-end: research, asset collection, script generation, video production (FFmpeg slideshow + edge-tts), content packaging to a ready-to-upload folder. Six silent failure bugs were just fixed (deadlocks, broken packages, missing status transitions, TTS failures, font config).

What remains is not new features. It is making the existing pipeline reliable enough to run confidently every day without babysitting.

---

## Phase 1: Fix Data Gaps

**Goal:** Every field on QueuedProduct and AssetManifest is populated with real data. No more nulls or empty arrays where values should exist.

**Why first:** These gaps propagate downstream. The scriptwriter gets empty benefits, the analyst has no commission data to analyze, and scoring is missing a signal. Nothing else matters until the data flowing through the pipeline is correct.

**Tasks:**

1. **Commission rate extraction** -- The ScrapeCreators product detail response does not include commission rates (confirmed by reviewing the SCProductDetailResponse type). Since this data is not available from the API, the fix is to remove commissionRate from the scoring model and QueuedProduct, or mark it explicitly as user-supplied. Recommendation: keep the field but add a `scripts/update-commission.ts` utility that lets the user bulk-set commission rates from a CSV after they check TikTok Shop affiliate center manually. Remove it from scoring weights (it is not in the weights today anyway, so this is mostly a documentation/cleanup task).
   - Files: `src/shared/types.ts`, `src/researcher/index.ts`, `src/asset-collector/index.ts`

2. **ingredientsOrSpecs population** -- The product detail response has no structured ingredients field. But the product title and review text often contain this info. Extract specs from SKU variant names (`details.skus[].title`) and from product description patterns. If nothing found, leave empty -- but log it so we know.
   - Files: `src/asset-collector/index.ts` (add `extractSpecs` function alongside `extractBenefits`)

3. **Tests:** Unit tests for `extractSpecs`, `extractBenefits` with real API response fixtures. Test that AssetManifest comes back with populated fields from a mock detail response.
   - Files: `src/asset-collector/__tests__/extract.test.ts`

**Estimated scope:** 1 session.

---

## Phase 2: Startup Validation and Network Resilience

**Goal:** The pipeline fails fast on bad config and retries gracefully on transient network errors.

**Why second:** Right now if SCRAPECREATORS_API_KEY is missing, you get a runtime crash mid-pipeline after some work is already done. And any network blip kills the entire run. These are the two most likely failure modes in daily operation.

**Tasks:**

1. **Config/env validation at startup** -- Add a `validateEnvironment()` function that checks: SCRAPECREATORS_API_KEY exists, ANTHROPIC_API_KEY exists, config.json is readable and has required fields, font file exists at configured path, output directories are writable. Call it as the first line in `run-pipeline.ts`.
   - Files: `src/shared/config.ts` (add `validateEnvironment`), `scripts/run-pipeline.ts`

2. **Retry with backoff on ScrapeCreatorsClient** -- Add retry logic to the `request()` method in the client. Retry on 429 (rate limit), 500, 502, 503, 504. Max 3 attempts, exponential backoff starting at 1s. Do NOT retry on 400/401/403/404 (those are real errors).
   - Files: `src/shared/scrape-creators-client.ts`

3. **Tests:** Test that `validateEnvironment` throws on missing API key. Test that retry logic retries on 503 and does not retry on 400. Mock fetch for these.
   - Files: `src/shared/__tests__/config.test.ts`, `src/shared/__tests__/scrape-creators-client.test.ts`

**Estimated scope:** 1 session.

---

## Phase 3: Inter-Step File Validation

**Goal:** Each pipeline step verifies its inputs exist before running, and produces a clear error (not a silent skip or cryptic crash) when they do not.

**Why third:** After Phase 2, the pipeline starts reliably. But if any single step partially fails (e.g., asset collection downloads 2 of 5 images, then script gen tries to reference missing files), the downstream steps produce garbage or crash. This phase makes the pipeline self-checking.

**Tasks:**

1. **Asset manifest validation before script generation** -- Before `writeAllScripts` processes a product, verify: meta.json exists for that product, images array has at least MIN_IMAGES paths that exist on disk, if hasVideo is true then videoPath exists. Skip product with `script_failed` status and clear error if validation fails.
   - Files: `src/scriptwriter/index.ts`

2. **Script + assets validation before video production** -- Before `produceAllVideos` processes a product, verify: script.json exists and parses, all image paths referenced in the script exist, TTS audio will have a non-empty voiceover string. Skip with `video_failed` status if not.
   - Files: `src/video-producer/index.ts`

3. **Video file validation before content packaging** -- The content manager already checks `existsSync(videoPath)` (good). Add: verify file size is > 0 bytes, verify the path matches expected naming convention. This is minor but prevents packaging corrupt/empty files.
   - Files: `src/content-manager/index.ts`

4. **Tests:** Test validation functions with missing files, empty files, partial manifests.
   - Files: `src/scriptwriter/__tests__/validation.test.ts`, `src/video-producer/__tests__/validation.test.ts`

**Estimated scope:** 1 session.

---

## Phase 4: Wire Up the Analyst

**Goal:** The analyst feedback loop actually runs and produces useful signals that the researcher consumes.

**Why fourth:** The analyst code exists and is correct, but `analyzePerformance` and `getWeeklyReport` are never called. `generateSignals` is called in the pipeline but only produces meaningful output with 3+ videos with performance data. This phase closes the loop.

**Tasks:**

1. **Add `scripts/update-performance.ts`** -- A script the user runs after checking TikTok analytics manually. Takes a product ID and metrics (views, likes, comments, shares, clicks, conversions, commission) and calls `updatePerformance`. Accepts a JSON file or CLI args.
   - Files: `scripts/update-performance.ts`

2. **Add `scripts/weekly-report.ts`** -- Standalone script that calls `analyzePerformance()` and prints `getWeeklyReport()`. Simple, just needs to exist.
   - Files: `scripts/weekly-report.ts`

3. **Wire `analyzePerformance` into the pipeline** -- After `generateSignals()` in run-pipeline.ts, call `analyzePerformance()` so the user sees the analysis in every pipeline run's output.
   - Files: `scripts/run-pipeline.ts`

4. **Add npm scripts** -- Add `update-perf` and `report` to package.json scripts.
   - Files: `package.json`

5. **Tests:** Test `updatePerformance` correctly merges partial data. Test `generateSignals` output shape with synthetic posted data.
   - Files: `src/analyst/__tests__/analyst.test.ts`

**Estimated scope:** 1 session.

---

## Phase 5: Pipeline Run Summary and Error Surfacing

**Goal:** Every pipeline run produces a clear summary of what happened, what failed, and what needs attention. Errors are not buried in scrollback.

**Why fifth:** With phases 1-4 done, the pipeline is data-correct, resilient, self-checking, and has a feedback loop. The remaining gap is observability. When something goes wrong, the user should not need to grep logs.

**Tasks:**

1. **Structured run summary** -- At the end of `run-pipeline.ts`, print a summary table: products researched, assets collected (success/fail counts), scripts written, videos produced, packages built, errors encountered. Pull from state files and the errors accumulated during the run.
   - Files: `scripts/run-pipeline.ts`

2. **Error log rotation** -- `state/errors.json` grows forever. Add a `trimErrors()` function that keeps only the last 7 days of errors. Call it at pipeline start.
   - Files: `src/shared/state.ts`, `scripts/run-pipeline.ts`

3. **Dashboard: show errors and last run** -- The dashboard currently reads state for display. Add a panel showing last-run.json data and the most recent errors from errors.json. This makes the dashboard actually useful for daily operations.
   - Files: `dashboard/src/components/` (new component), `dashboard/src/app/page.tsx`

4. **Tests:** Test error trimming logic. Test summary generation with various pipeline outcomes.
   - Files: `src/shared/__tests__/state.test.ts`

**Estimated scope:** 1-2 sessions (dashboard work is the variable).

---

## Dependency Graph

```
Phase 1 (data gaps)
    |
Phase 2 (startup validation + retry)
    |
Phase 3 (inter-step file validation)
    |
Phase 4 (analyst wiring)
    |
Phase 5 (summary + observability)
```

Phases 1 and 2 are independent of each other and could run in parallel if two people were working. Phases 3-5 are sequential -- each builds on the reliability guarantees of the previous.

---

## What This Plan Does NOT Include

Per scope constraints:

- No auto-posting to TikTok. Ready-to-upload folder remains the final output.
- No TikTok Analytics API integration. Performance data is entered manually via the update script.
- No AI video generation APIs. FFmpeg slideshow is the video approach.
- No additional data sources beyond ScrapeCreators.
- No cron/scheduling. Pipeline runs manually.
- No error recovery (retry failed products from previous runs). That comes after stability.
- Tests are written alongside each phase, not as a separate effort.

---

## Key Files Reference

| File | Role |
|------|------|
| `scripts/run-pipeline.ts` | Pipeline orchestrator, touched in phases 2, 4, 5 |
| `src/shared/scrape-creators-client.ts` | API client, touched in phase 2 |
| `src/shared/config.ts` | Config loading, touched in phase 2 |
| `src/shared/state.ts` | State read/write, touched in phase 5 |
| `src/shared/types.ts` | Type definitions, touched in phase 1 |
| `src/researcher/index.ts` | Product research, touched in phase 1 |
| `src/asset-collector/index.ts` | Asset collection, touched in phases 1, 3 |
| `src/scriptwriter/index.ts` | Script generation, touched in phase 3 |
| `src/video-producer/index.ts` | Video production, touched in phase 3 |
| `src/content-manager/index.ts` | Content packaging, touched in phase 3 |
| `src/analyst/index.ts` | Performance analysis, touched in phase 4 |
| `dashboard/src/` | Next.js dashboard, touched in phase 5 |
