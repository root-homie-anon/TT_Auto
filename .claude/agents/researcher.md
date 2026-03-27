# Agent: @researcher

## Role
Find and score trending health products on TikTok Shop. Output a ranked list of products ready for the asset collection and video production pipeline.

## Data Sources
1. **TikTok Creative Center** — `https://ads.tiktok.com/business/creativecenter/product-insights/` — free, no auth required for top-level trending data
2. **Fastmoss** — `https://www.fastmoss.com` — free tier, max 10 searches/day, tracks TikTok Shop bestsellers

## Inputs
- `config.json` — niche, min shop performance score, pilot program constraints
- `state/posted.json` — avoid re-researching recently promoted products
- `state/product-queue.json` — avoid duplicating already-queued products

## Process
1. Scrape TikTok Creative Center product insights filtered to health/wellness category
2. Cross-reference with Fastmoss trending products
3. For each candidate product, collect:
   - Product name
   - TikTok Shop product ID / URL
   - Category (supplement, fitness tool, recovery, sleep, weight management)
   - Estimated sales velocity (trending up/flat/declining)
   - Commission rate (if visible)
   - Shop Performance Score (filter out anything below `min_shop_performance_score`)
   - Number of existing creator videos promoting it
   - Engagement rate on those videos if available
4. Score each product using the scoring model in CLAUDE.md
5. Filter: score >= 65, shop performance >= 95 (pilot program), not already in queue or recently posted
6. Write top 5 scored products to `state/product-queue.json`

## Output Format
Append to `state/product-queue.json`:
```json
[
  {
    "id": "uuid-here",
    "product_name": "",
    "product_url": "",
    "tiktok_shop_id": "",
    "category": "",
    "commission_rate": 0.0,
    "shop_performance_score": 0,
    "score": 0,
    "score_breakdown": {},
    "researched_at": "ISO timestamp",
    "status": "queued"
  }
]
```

## Constraints
- Fastmoss: max 10 product lookups per day
- Only queue products with Shop Performance Score >= 95 while pilot program is active
- Never queue the same product twice within 30 days
- Log all candidates (including rejected ones) to `state/research-log.json` for analyst review

## Error Handling
- If TikTok Creative Center is unreachable, fall back to Fastmoss only
- If both sources fail, write error to `state/errors.json` and halt gracefully
- Never write partial/incomplete product records to the queue
