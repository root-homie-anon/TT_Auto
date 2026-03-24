# Health Is Wealth — Master Project File

## System Overview
Automated TikTok Shop affiliate content pipeline for the "Health is Wealth" channel. The system identifies trending health products on TikTok Shop, sources product assets from seller/manufacturer listings, generates AI-powered videos matched to each product, and packages them for posting. Goal is consistent daily video output that drives affiliate commissions. Human handles posting only — everything else is automated. Built to scale to multiple niche channels once the first channel proves the model.

---

## Session Start Hook
On every session start, fire the agent factory hook:
```
bash ~/.claude/hooks/session-start.sh "health-is-wealth" "$(pwd)"
```
This loads existing agents, offers to create new ones if needed, and prepares the session.

---

## Orchestrator Behavior

This file is the root orchestrator. On session start:

1. Fire the session-start hook
2. Load state from `state/` — check last run date, queued products, posted videos
3. Ask the user: run daily pipeline, review queue, check analytics, or manage config
4. Spawn subagents scoped to their domain — they share no state unless explicitly passed
5. Researcher and Asset Collector can run in parallel once product list is ready

### Daily Pipeline (default run)
```
@researcher → trending products scored + queued
     ↓
@asset-collector → product assets pulled (runs per product, parallelizable)
     ↓
@scriptwriter → hooks + voiceover + on-screen text generated
     ↓
@video-producer → AI video assembled per product
     ↓
@content-manager → output packaged, renamed, ready-to-post folder prepared
     ↓
[HUMAN] posts to TikTok manually
     ↓
@analyst → tracks performance, feeds signal back to researcher
```

### Pilot Program Constraints (active until 5k followers)
- Max 5 product promotion videos per week — content manager enforces this
- Only promote products with TikTok Shop Performance Score 95%+
- Researcher filters for this automatically

---

## Agent Team
All agents live in `.claude/agents/` and are invoked by the orchestrator.

| Agent | File | Role |
|-------|------|------|
| `@orchestrator` | `CLAUDE.md` | Drives sessions, delegates tasks, manages state |
| `@researcher` | `.claude/agents/researcher.md` | Finds trending health products on TikTok Creative Center + Fastmoss, scores and queues them |
| `@asset-collector` | `.claude/agents/asset-collector.md` | Pulls product images, video, description, price, commission rate from TikTok Shop listings and manufacturer pages |
| `@scriptwriter` | `.claude/agents/scriptwriter.md` | Writes hook, voiceover script, and on-screen text for each product based on category and format rules |
| `@video-producer` | `.claude/agents/video-producer.md` | Takes assets + script and generates final video using AI video tools |
| `@content-manager` | `.claude/agents/content-manager.md` | Organizes daily output, enforces weekly posting limits, packages videos for manual posting |
| `@analyst` | `.claude/agents/analyst.md` | Tracks views, engagement, and affiliate conversions per video; feeds signal back to researcher scoring model |

---

## Project Structure

```
health-is-wealth/
├── CLAUDE.md                        ← this file, root orchestrator
├── config.json                      ← project config and feature flags
├── .env                             ← secrets, never committed
├── .env.example                     ← documents all required env vars
├── .claude/
│   └── agents/                      ← all agent definition files
│       ├── researcher.md
│       ├── asset-collector.md
│       ├── scriptwriter.md
│       ├── video-producer.md
│       ├── content-manager.md
│       └── analyst.md
├── src/
│   ├── researcher/                  ← scraping + scoring logic
│   ├── asset-collector/             ← asset fetching + storage logic
│   ├── scriptwriter/                ← script generation prompts + templates
│   ├── video-producer/              ← video generation integrations
│   ├── content-manager/             ← queue management + output packaging
│   └── analyst/                     ← performance tracking + feedback loop
├── scripts/
│   ├── run-pipeline.ts              ← full daily pipeline runner
│   ├── run-researcher.ts            ← run researcher only
│   ├── run-video.ts                 ← generate video for a specific product
│   └── check-queue.ts               ← view current content queue
├── state/                           ← runtime state, gitignored
│   ├── product-queue.json           ← products researched, pending video
│   ├── video-queue.json             ← videos ready to post
│   ├── posted.json                  ← posted video log
│   └── last-run.json                ← last pipeline run metadata
├── shared/
│   ├── product-categories.md        ← health subcategory definitions + video format rules
│   ├── hook-formulas.md             ← proven hook structures for health content
│   └── brand-guidelines.md          ← Health is Wealth tone, style, dos/don'ts
└── output/                          ← ready-to-post videos, gitignored
    └── [YYYY-MM-DD]/                ← dated folders per batch
```

---

## config.json Schema

```json
{
  "project": {
    "name": "Health is Wealth",
    "slug": "health-is-wealth",
    "version": "1.0.0"
  },
  "channel": {
    "niche": "health",
    "tiktok_handle": "",
    "pilot_program_active": true,
    "max_videos_per_week": 5,
    "min_shop_performance_score": 95
  },
  "pipeline": {
    "products_per_run": 5,
    "video_formats": ["voiceover", "hook-text", "demo"],
    "auto_select_format": true
  },
  "sources": {
    "tiktok_creative_center": true,
    "fastmoss": true,
    "fastmoss_daily_limit": 10
  },
  "credentials": {
    "env_file": ".env"
  },
  "features": {
    "auto_post": false,
    "multi_channel": false,
    "analyst_feedback_loop": true
  }
}
```

---

## Product Scoring Model
Researcher scores each product before queuing. Higher score = higher priority.

| Signal | Weight |
|--------|--------|
| Sales velocity (trending up) | 30% |
| Commission rate | 25% |
| Shop Performance Score | 20% |
| Video engagement on existing promos | 15% |
| Asset availability (images/video quality) | 10% |

Minimum score to queue: 65/100. Products below threshold are logged but skipped.

---

## Video Format Rules
Scriptwriter selects format based on product category:

| Category | Default Format | Rationale |
|----------|---------------|-----------|
| Supplements / ingestibles | Voiceover + results text | Claims need VO context, no demo possible |
| Fitness tools / equipment | Demo style | Visual transformation drives CTR |
| Recovery / massage devices | Demo + hook text | Show the sensation, lead with pain point |
| Sleep / wellness | Hook text + ambient visuals | Emotional hook, soft sell |
| Weight management | Voiceover + before/after framing | Results-forward content converts |

---

## Brand Guidelines (Health is Wealth)
- Tone: confident, direct, results-focused — not salesy
- Always lead with the problem, not the product
- No fake urgency ("limited time!!!") — let the product speak
- On-screen text should be readable in first 2 seconds
- Videos target 15-30 seconds for feed, 45-60 for product demos
- Captions always include primary keyword + product name + CTA

---

## State Management
All pipeline state written to `state/` as JSON. Never held in memory only.

- `product-queue.json` — array of scored products awaiting video production
- `video-queue.json` — completed videos awaiting posting, includes suggested caption + hashtags
- `posted.json` — log of all posted videos with date, product, and performance tracking ID
- `last-run.json` — timestamp, products found, videos produced, errors

---

## Automation Assumptions
- Everything automated unless marked [HUMAN]
- All long-running tasks async with state written to `state/`
- Agents are stateless — all context passed explicitly per invocation
- Errors logged to `state/errors.json` and surfaced to terminal
- No manual steps in the critical path except posting (temporary)

---

## Code Standards
- TypeScript strict mode — no `any`, explicit return types
- Naming: kebab-case files, PascalCase classes/types, camelCase functions, UPPER_SNAKE_CASE constants
- Formatting: Prettier, single quotes, semicolons, 2-space indent, 100 char line width
- Imports: external libs → internal utils → services → types
- Async: always async/await, never callbacks
- Errors: custom error classes per domain

---

## Scale Roadmap
| Milestone | Trigger | Action |
|-----------|---------|--------|
| Auto-posting | First affiliate revenue | Integrate repurpose.io |
| Graduate pilot | 5k followers or 30-day completion | Remove posting limits, enable campaigns |
| Channel 2 | Channel 1 generating consistent revenue | Clone pipeline, new niche (beauty) |
| Channel N | Proven multi-channel ops | Full multi-channel orchestration |

---

## Initialization Checklist
- [ ] Clone repo and run `npm install`
- [ ] Copy `.env.example` → `.env` and fill in all values
- [ ] Set `tiktok_handle` in `config.json`
- [ ] Apply for TikTok Shop affiliate access on the Health is Wealth account
- [ ] Run `bash ~/.claude/hooks/session-start.sh "health-is-wealth" "$(pwd)"`
- [ ] Verify agents load correctly
- [ ] Run `npx ts-node scripts/run-researcher.ts` to test product sourcing
- [ ] Confirm first product batch queued in `state/product-queue.json`
