# TT_Auto — Project State

## Identity
**Project:** Health is Wealth (TT_Auto)
**Purpose:** Automated TikTok Shop affiliate content pipeline for a single health/wellness channel. Research trending products → collect assets → write scripts → produce videos → package for manual posting. Human posts only; everything upstream is automated. Designed to scale to multiple niche channels once channel one proves the model.
**Root:** `/Users/macmini/projects/TT_Auto`

## Status
**Pipeline is built end-to-end and working.** All five phases of `docs/architecture/phased-build-plan.md` have shipped (see git log: `feat: phase 1`, `feat: implement phases 2-5`, and subsequent hardening commits). Error recovery (retry + dead-letter + file locking), pilot-aware captions, and a 99-test Vitest suite are also in. Working tree is clean on `main`.

Current phase: **Operational hardening + daily-run discipline.** The phased plan solved correctness and reliability. What remains is automation, observability in the dashboard, and the missing pieces the plan explicitly excluded (auto-posting, TikTok analytics ingest, retry-from-previous-run).

## Architecture Snapshot

**Stack:** TypeScript (strict, ESM), Node via `tsx`, Vitest. Next.js dashboard in `dashboard/`. No database — all state is JSON files under `state/` (runtime, gitignored). FFmpeg for video assembly, `edge-tts` for voiceover, Anthropic SDK for scripts, ScrapeCreators API for product data.

**Pipeline (scripts/run-pipeline.ts):**
1. `@researcher` — ScrapeCreators search → score → queue (threshold 65)
2. `@asset-collector` — per-product image/video/spec fetch, writes `AssetManifest`
3. `@scriptwriter` — Anthropic-driven, format-selected per category
4. `@video-producer` — FFmpeg slideshow + edge-tts (Kling is config primary but ffmpeg-slideshow is current fallback-in-practice)
5. `@content-manager` — packages to `output/YYYY-MM-DD/`, enforces 5-per-week pilot cap
6. `@analyst` — `generateSignals()` + `analyzePerformance()` each run

**Status machine (src/shared/types.ts):** `queued → assets_ready → script_ready → video_ready → post_ready → posted`, with `*_failed` branches feeding into retry → `dead_letter`.

**State files (state/, gitignored at runtime):**
- `product-queue.json` · `video-queue.json` · `posted.json`
- `last-run.json` · `errors.json` · `research-log.json`
- `analyst-signals.json` · `pipeline.lock`

**Dashboard:** Next.js App Router, reads state/ directly via `lib/state-reader.ts`. Components exist for products, performance, research log, errors, last-run, pipeline stages, analyst panel.

## Constraints (Pilot Program — active until 5k followers)
- Max 5 promo videos per week (enforced by content-manager)
- Only promote products with Shop Performance Score ≥ 95
- No affiliate links in captions during pilot phase (pilot-aware captions shipped)
- Posting is manual; auto-post is behind a feature flag (`features.autoPost: false`)

## Known Gaps / Non-Goals (per phased-build-plan §"What This Plan Does NOT Include")
These were *explicitly* deferred and remain open:
- No auto-posting to TikTok — ready-to-upload folder is final output
- No TikTok Analytics API — performance entered manually via `update-performance.ts`
- No AI video generation API (Kling configured but slideshow is the working path)
- No additional data sources beyond ScrapeCreators
- No cron/scheduling — pipeline runs manually
- No retry-from-previous-run sweep — in-run retry + dead-letter only

## Key Files
- **Orchestrator doc:** `/Users/macmini/projects/TT_Auto/CLAUDE.md`
- **Canonical roadmap (historical):** `/Users/macmini/projects/TT_Auto/docs/architecture/phased-build-plan.md`
- **Config:** `/Users/macmini/projects/TT_Auto/config.json` · `.env.example`
- **Pipeline entry:** `/Users/macmini/projects/TT_Auto/scripts/run-pipeline.ts`
- **Types (source of truth):** `/Users/macmini/projects/TT_Auto/src/shared/types.ts`
- **Agent specs:** `/Users/macmini/projects/TT_Auto/{researcher,asset-collector,scriptwriter,video-producer,content-manager,analyst}.md`
- **Dashboard:** `/Users/macmini/projects/TT_Auto/dashboard/src/`

## Team (project-local agents under `.claude/agents/`)
`@researcher · @asset-collector · @scriptwriter · @video-producer · @content-manager · @analyst`
Marcus routes; Tony audits design changes before implementation; Doug implements backend; Ava owns dashboard.

## Default Stack Alignment
User preference is local Postgres + Auth.js + filesystem storage. TT_Auto currently uses **filesystem JSON state only** — no DB, no auth (it's a single-operator CLI). No Supabase anywhere. No migration needed.
