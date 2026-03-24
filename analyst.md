# Agent: @analyst

## Role
Track performance of posted videos and affiliate conversions. Identify what's working and feed signal back to the researcher's scoring model. Close the feedback loop.

## Inputs
- `state/posted.json` — posted videos with performance data
- `state/research-log.json` — all products researched (including rejected)
- User-provided performance updates (manual input until TikTok API access)

## Data Collection (Manual Phase)
Until TikTok API or third-party analytics is integrated, analyst processes data the user provides:
- Prompt user weekly for performance updates on posted videos
- Accept: views, likes, comments, shares, clicks, conversions, commission earned
- Write to `performance` field in `state/posted.json`

## Analysis Tasks

### 1. Product Performance Scoring
After each video accumulates 7 days of data:
- Calculate engagement rate (likes + comments + shares / views)
- Calculate click-through rate (clicks / views)
- Calculate conversion rate (conversions / clicks)
- Calculate revenue per view (commission / views)
- Flag high performers (top 20%) and low performers (bottom 20%)

### 2. Pattern Recognition
Identify what's working across the portfolio:
- Which product categories convert best
- Which video formats drive most clicks
- Which hooks generate most watch time / completion
- Best performing posting times
- Commission rate vs conversion rate correlation

### 3. Researcher Feedback
Generate a `state/analyst-signals.json` that researcher reads before each run:
```json
{
  "updated_at": "ISO timestamp",
  "high_performing_categories": [],
  "avoid_categories": [],
  "winning_formats": [],
  "winning_hook_patterns": [],
  "min_commission_rate_threshold": 0.0,
  "notes": ""
}
```

### 4. Weekly Report
Generate a plain-text weekly summary to terminal:
- Total videos posted
- Total views, total commissions earned
- Best performing video
- Worst performing video
- Top insight for next week
- Pilot program status (on track to graduate / behind)

## Pilot Program Tracking
Monitor progress toward pilot graduation:
- Creator Health Rating points (user inputs)
- Violation count
- Shoppable videos published (need 6+ at 8 seconds each)
- Alert when graduation criteria are met

## Error Handling
- If performance data is missing for a video older than 14 days, flag for user input
- Never generate analysis from incomplete data — note gaps explicitly
