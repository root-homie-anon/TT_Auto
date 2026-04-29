# Signal-to-Weight Mapping Contract

**Status:** Approved design (Tony) — implemented by Doug in C1.
**Scope:** How analyst-derived signals adjust the researcher's static product score, defined as a **bounded post-process** layered on top of the static weight table in `src/researcher/scorer.ts`. Phase C1 only. Hook-pattern injection (C2) and freshness logging wiring (C3) are scoped here at the type level so the contract is shared, but their behavioural implementation is out of scope for C1.

---

## 1. Goal & Non-Goals

**Goal.** Close the analyst → researcher feedback loop (Phase C of `state/roadmap.md`) so the researcher's product ranking adapts to what's actually performed on the channel. Concretely: boost categories that converted, gate out categories that didn't, enforce a commission floor derived from observed revenue distribution, and define the type/contract that C2 will use to inject winning hook patterns into the scriptwriter prompt.

**Non-goals.**
- **Replacing the static weight table.** The five-signal table in `CLAUDE.md` (and the four-signal table actually implemented in `config.scoring.weights` — see §8) is the *base* score. Signals adjust it; they do not redefine it.
- **Opaque ML / learned weights.** No model, no embeddings, no learned parameters. Every adjustment is a deterministic, hand-specified rule with a stated maximum effect.
- **Runaway feedback.** Hard caps on every adjustment. The score is bounded. No multiplier compounds across rules. A small early sample can never push a single category to dominate the queue.
- **Compensating for upstream gaps.** This layer does not invent commission data the asset-collector hasn't yet populated. If `commissionRate` is `null`, the floor rule is skipped (see §4, "Commission floor").

---

## 2. `AnalystSignals` Schema

The interface lives in `src/shared/types.ts` (already partially defined — this contract extends it). Fields marked **(new)** are added in C1; others already exist and keep their semantics.

```ts
export interface AnalystSignals {
  /** ISO 8601 UTC timestamp of when these signals were computed. */
  updatedAt: string;

  /** Categories whose posted videos outperform the analyst's median by ≥ 20%. */
  highPerformingCategories: ProductCategory[];

  /** Categories whose posted videos fall below 50% of the analyst's median. */
  avoidCategories: ProductCategory[];

  /**
   * Analyst-derived commission floor (decimal, e.g. 0.15 = 15%). Products
   * scoring below this commission rate are filtered out. C1 default is 0
   * (no floor), which the analyst raises only when it has a defensible
   * lower-bound from observed revenue. Acts as a gate, not a tweak.
   */
  minCommissionRateThreshold: number;

  /**
   * Video formats correlated with high engagement. Reserved for future use
   * by the scriptwriter / video-producer; C1 does not consume it.
   */
  winningFormats: string[];

  /**
   * Hook copy patterns observed in top-performing videos. **Not consumed by
   * the scorer.** Defined here so the type is shared. C2 injects this into
   * the scriptwriter prompt. The score function ignores this field.
   */
  winningHookPatterns: string[];

  /**
   * (new) Number of posted videos with non-zero views that contributed to
   * this signal computation. Used by the freshness predicate (§5). The
   * analyst writes this at signal-generation time.
   */
  contributingVideoCount: number;

  /** Free-text notes from the analyst (insufficient-data warnings, etc.). */
  notes: string;
}
```

**What I checked before adding fields.** The analyst at `src/analyst/index.ts:97-171` already computes `withData.length` (videos with non-zero views) and gates on `< 3`. Persisting that count as `contributingVideoCount` is a one-line extension — the data is there, it just isn't written. Every other field already exists or has an obvious analyst computation path.

**What I deliberately did NOT add.**
- A per-category sample-count map. Tempting for confidence weighting, but pushes the analyst into territory it doesn't yet compute and adds a second source of truth for "how confident are we." `contributingVideoCount` + the freshness predicate covers this for C1.
- A `categoryBoostMagnitude` knob in signals. The boost magnitude is policy, not signal — it lives in this doc and (optionally) `config.json`, not in `analyst-signals.json`. Keeps the analyst dumb and the scorer's behaviour reviewable.

---

## 3. Function Signature

A new exported function in `src/researcher/scorer.ts`:

```ts
/**
 * Apply analyst-derived bounded adjustments to a base product score.
 *
 * Pure function — reads only its arguments, writes nothing. Logging of
 * staleness/missing-signals is the caller's responsibility (C3).
 *
 * @param baseScore  The 0-100 score from scoreProduct() using the static
 *                   weight table.
 * @param product    The QueuedProduct being scored. `category` and
 *                   `commissionRate` are the only fields read.
 * @param signals    Current AnalystSignals, or `null` / `undefined` if
 *                   the file does not exist or was never written.
 * @returns          Adjusted score in [0, 100], or `0` for filtered-out
 *                   products (commission floor or avoid-category if
 *                   filter mode is selected per §4).
 */
export function applySignalAdjustments(
  baseScore: number,
  product: QueuedProduct,
  signals: AnalystSignals | null | undefined,
): number;
```

**Error semantics.**
- `signals == null` (file missing or never generated) → return `baseScore` unchanged. No throw.
- `signals` is stale per §5 → return `baseScore` unchanged. No throw. C3 emits the log line; C1 just performs the predicate check and returns early.
- `signals.contributingVideoCount < 3` → treat as stale (same path).
- Any individual signal field missing/malformed (e.g. `highPerformingCategories` is undefined because of an old file) → defensive default to empty array / 0; never throw.
- The function never mutates `signals` or `product`.

---

## 4. Bounded Adjustment Rules

Apply rules in the order below. Each rule states its maximum effect on the score. The **total** worst-case deviation from `baseScore` is bounded by §4.5.

### 4.1 Commission floor (gate)

If `signals.minCommissionRateThreshold > 0` **and** `product.commissionRate != null` **and** `product.commissionRate < signals.minCommissionRateThreshold`:
- **Return `0`.** Hard filter. The product is dropped from queueing because it cannot earn enough to justify the slot, per analyst observation.

If `product.commissionRate == null` (asset-collector hasn't populated it yet — see §8 gap), the floor cannot be evaluated. **Skip the rule.** Do not filter on missing data. The product flows to the next rule with `baseScore` intact.

If `signals.minCommissionRateThreshold == 0` (analyst's default; no floor learned yet), skip the rule.

**Maximum effect:** `-baseScore` (full filter) or `0` (skip).

### 4.2 Category penalty (capped, not filtered)

If `product.category` is in `signals.avoidCategories`:
- **Cap the score at 50.** Return `min(adjustedScore, 50)`.

**Why cap rather than filter.** A flat filter is too aggressive for a 3-video sample — one bad early video could permanently exclude a category. Capping at 50 means an avoid-category product can still queue if its base score is otherwise weak (it was going to score ≤ 50 anyway, no effect) but a strong-on-paper avoid-category product is held back from beating high-performers. This degrades gracefully as the sample grows; the analyst can later set `minCommissionRateThreshold` or recompute and lift the avoid-flag if performance improves.

**The cap value `50`** sits one point below the queue-eligibility floor (`scoring.minScoreToQueue = 65`), which means the avoid-category cap effectively excludes the product from queueing today. This is intentional: the cap **acts** as a soft filter under current config, but if the operator later lowers `minScoreToQueue` (e.g. for testing), avoid-category products won't all silently re-enter the queue at the top of the pile — they'll still be capped at 50 and ranked below uncapped products.

**Maximum effect:** clamps `adjustedScore` to ≤ 50; net effect ranges from `0` (when `baseScore ≤ 50`) to `-50` (when `baseScore = 100`).

### 4.3 Category boost (additive, capped)

If `product.category` is in `signals.highPerformingCategories`:
- **Add `+10` to the score.** `adjustedScore = adjustedScore + 10`.

**Why additive `+10` not multiplicative `× 1.15`.** Multiplicative boosts favour products that already scored high — a 90 → 103.5 boost helps a strong product more than a 65 → 74.75 boost helps a marginal one. The whole point of the feedback loop is to elevate products in winning categories *that wouldn't otherwise queue*, not to widen the gap between hits. Additive is more equitable across the score range.

**Why `+10`.** The base score floor for queueing is 65; `+10` is enough to lift a high-60s product to mid-70s (clearly above threshold) but not enough to lift a low-50s product (which probably has other problems) into queueing. It's also small enough that two compounded boosts (which we forbid anyway — see below) would still leave the adjustment within a single static-weight unit's reasonable range.

**No compounding.** A product is in a category or it isn't — you cannot match multiple high-performing categories. The category lookup is a single equality check on `product.category`. The cap on boost effect is therefore `+10` flat.

**Maximum effect:** `+10` (or `0` if not in `highPerformingCategories`).

### 4.4 Hook pattern injection — NOT scored

`signals.winningHookPatterns` is **ignored by `applySignalAdjustments`**. It is scoped to the type so C2 (scriptwriter prompt injection) reads from the same `AnalystSignals` object loaded by the researcher. The score function does not read this field.

**Maximum effect on score:** `0`.

### 4.5 Bounding & clamp

After the rules above run, apply final clamp:

```ts
return Math.max(0, Math.min(100, adjustedScore));
```

**Worst-case score deviation from `baseScore`:**
- **Lower bound:** the commission-floor gate sets the score to `0` (full drop). Among non-gating rules, the avoid-category cap can subtract up to `50` (when `baseScore = 100`).
- **Upper bound:** `+10` from category boost.
- A product cannot simultaneously be in `highPerformingCategories` and `avoidCategories` (the analyst's logic at `src/analyst/index.ts:151-159` partitions by median, so the sets are disjoint by construction). Both code paths can therefore be evaluated unconditionally, but the `if/else` in implementation should reflect this and not double-touch the score.
- The final clamp ensures the output is always in `[0, 100]`.

**Worked example.** `baseScore = 72`, product in `highPerformingCategories`:
- Commission floor: skipped (commission null or above threshold).
- Avoid-category penalty: skipped (category not in avoid list).
- Boost: `72 + 10 = 82`.
- Clamp: `82`.
- Result: `82`. Strong queue priority, +10 over base.

**Worked example.** `baseScore = 88`, product in `avoidCategories`:
- Commission floor: skipped.
- Penalty: `min(88, 50) = 50`.
- Boost: skipped.
- Clamp: `50`.
- Result: `50`. Below `minScoreToQueue` (65), so dropped at queue-decision time.

**Worked example.** `baseScore = 70`, `commissionRate = 0.08`, `minCommissionRateThreshold = 0.15`:
- Commission floor: `0.08 < 0.15` → return `0` immediately.
- Result: `0`. Filtered.

**Worked example.** `baseScore = 70`, `commissionRate = null`, in high-performing category:
- Commission floor: skipped (null commission, can't evaluate — see §8 gap).
- Boost: `70 + 10 = 80`.
- Result: `80`.

---

## 5. Freshness Contract

Stale signals are worse than no signals — they encode old behaviour as if it were current. The function **ignores** signals that fail the freshness predicate and returns `baseScore`.

### Predicate

Signals are **fresh** if and only if:
1. `signals != null`, AND
2. `Date.now() - new Date(signals.updatedAt).getTime() < 14 * 24 * 60 * 60 * 1000` (less than 14 days old), AND
3. `signals.contributingVideoCount >= 3`.

Otherwise, signals are stale. Return `baseScore` unchanged.

### Why 14 days

The pilot program (`config.channel.maxVideosPerWeek = 5`) caps posting at 5 videos/week, so 14 days = ~10 posted videos in the best case. That's enough sample to compute meaningful category medians but recent enough that channel behaviour hasn't drifted. Going shorter (7 days = ~5 videos) would yield signals dominated by single-video noise. Going longer (30 days) is fine for the "still trustworthy" question but the analyst recomputes signals every pipeline run, so 30 days would only matter when the analyst itself stalls — and at that point a missing-data signal is more honest than an old one.

### Why `contributingVideoCount >= 3`

This matches the existing analyst gate at `src/analyst/index.ts:111` (`if (withData.length < 3)`). The analyst already won't compute meaningful category splits below 3, so the predicate is consistent: the scorer trusts what the analyst trusted itself to compute.

### Log line C3 must emit

When the predicate fails, the scorer does **not** log directly (it's a pure function). The **caller** in `src/researcher/index.ts` is responsible for emitting one log line per pipeline run (not per product) when signals are absent or stale. This avoids N×M log spam.

C3 will use the existing `appendError` logger with `level: 'warn'`:

```ts
appendError({
  timestamp: new Date().toISOString(),
  agent: 'researcher',
  level: 'warn',
  message: 'analyst-signals stale or missing — falling back to base score',
  details: signals
    ? `updatedAt=${signals.updatedAt}, contributingVideoCount=${signals.contributingVideoCount}`
    : 'no analyst-signals.json found',
});
```

The reasoning: `appendError` with `level: 'warn'` is the existing pattern used throughout the codebase (see `src/shared/types.ts:184` for the optional `level` field on `PipelineError`). Using it keeps the dashboard's error-surfacing pipeline coherent — operators see a "stale signals" warn alongside other warnings, not in a separate channel.

---

## 6. Test Contract for C1

`src/researcher/__tests__/scorer.test.ts` must be extended with a `describe('applySignalAdjustments', ...)` block covering at minimum:

- **Null/undefined signals → fall through.** `applySignalAdjustments(72, product, null)` returns `72`. Same for `undefined`. No throw.
- **Stale signals (updatedAt > 14 days) → fall through.** Construct signals with `updatedAt = (now - 15 days).toISOString()` and `contributingVideoCount = 10`; expect `baseScore` returned unchanged.
- **Insufficient sample (`contributingVideoCount < 3`) → fall through.** Even with `updatedAt = now`, expect `baseScore` returned unchanged.
- **Category boost.** Product in `highPerformingCategories = ['recovery']`, `product.category = 'recovery'`, base 72 → expect 82. Cap test: base 95 → expect 100 (clamp, not 105).
- **Category penalty bounded.** Product in `avoidCategories = ['supplements']`, base 88 → expect 50. Base 40 → expect 40 (already below cap, no change).
- **Commission floor as gate.** `commissionRate = 0.08`, `minCommissionRateThreshold = 0.15` → expect `0`. `commissionRate = 0.20`, threshold `0.15` → no filter, normal flow.
- **Commission floor skipped on null commission.** `product.commissionRate = null`, threshold `0.15`, in `highPerformingCategories` → expect base + 10, **not** filtered. This locks in the "no false filtering on missing upstream data" rule.
- **Threshold == 0 → no floor.** Default analyst behaviour; no filtering regardless of `commissionRate`.
- **Disjoint sets respected.** Product in both lists (impossible by analyst construction, but defensive) — assert documented behaviour: penalty cap applied first, boost not added (or whichever order the implementation picks; lock it in via test so the behaviour is reviewable).
- **Final clamp.** Synthesise an input where boost + clamp interact (base 95 + boost 10 → 100, not 105). Already covered above; restated for clarity.
- **No mutation.** Pass a frozen `signals` object (`Object.freeze`) and a frozen `product`; assert no throw and correct return.

These extend the existing tests, which mock `loadConfig` (see `scorer.test.ts:4-22`) and use `makeSearchProduct` / `makeDetails` factories. Doug should add a `makeSignals` factory in the same style.

---

## 7. Implementation Hints for Doug

- **Where to call.** In `src/researcher/index.ts`, immediately after `scoreProduct(...)` returns at line ~150, before `meetsMinimumCriteria(...)` at ~159. Replace the local `score` variable with `const adjustedScore = applySignalAdjustments(score, product, signals);`. Pass `adjustedScore` (not the raw `score`) into `meetsMinimumCriteria` and into `QueuedProduct.score`. Keep the original `score` available locally if you want to log the delta in `ResearchLogEntry` (worth doing — operators will want to see "boosted from 65 → 75").
- **Loading `analyst-signals.json`.** Read once at the top of `runResearcher()` via `readAnalystSignals()` (already exists at `src/shared/state.ts:183`). Pass the same object to every product in the loop. Do not re-read per product.
- **Where to log staleness.** Top of `runResearcher()`, right after the read. One log line per run, not per product. See §5 for the exact line. Wrap in a small helper (`logSignalStatus(signals)`) so the predicate and log live in one place — it's easier to test and the log line is less likely to drift from the predicate.
- **Where the predicate lives.** Co-locate the freshness predicate with `applySignalAdjustments` in `scorer.ts` and export it (`isSignalsFresh(signals): boolean`). The caller uses it for its log decision; the function uses it internally. One source of truth for "fresh."
- **Add `contributingVideoCount` to `generateSignals()`.** Small companion change in `src/analyst/index.ts`: write `signals.contributingVideoCount = withData.length` at line ~108 (right after `signals.notes = ''`). Without this, the predicate will always fail and the loop will never engage. This is a C1 prerequisite; ship it in the same commit as the scorer changes.

---

## 8. Gaps Identified Against `CLAUDE.md`

These are pre-existing inconsistencies between `CLAUDE.md`'s scoring model and the implementation, surfaced during this design. **Doug should resolve them in C1 or escalate to Marcus / the user before C1 if the answer isn't obvious.**

1. **Commission rate is in `CLAUDE.md`'s 5-signal weight table (25%) but is not in the implemented 4-weight scorer.** `config.scoring.weights` has only `salesVelocity`, `shopPerformance`, `videoEngagement`, `assetAvailability` (`config.json:30-37`). The scorer has no commission term. This contract treats commission as a **gate** in C1 (via the floor), which is consistent with the implementation today and avoids re-opening the static weight table. If the user wants commission as a 5th weight, that's a separate task — flag to Marcus.
2. **Static weights in code don't match `CLAUDE.md`.** `CLAUDE.md` says 30/25/20/15/10. `config.json` and `scorer.ts` use 35/30/20/15 (4 weights, summing to 1.0). This is independent of Phase C but worth noting in the C1 PR description so the user knows the doc is now visibly out of sync with reality. Either update `CLAUDE.md` or update `config.json` — not Tony's call.
3. **`QueuedProduct.commissionRate` is always `null` at the scoring stage.** Set to `null` in `src/researcher/index.ts:185`. The asset-collector may populate it later, but the scorer never sees a non-null value today. The commission-floor rule in §4.1 therefore degrades to a no-op in current behaviour — by design (skip on null), but the operator should be aware. C1 ships the rule; full activation depends on asset-collector populating commissions, which is a separate task.
4. **The four sub-signals in `ScoreBreakdown` are persisted on `QueuedProduct.scoreBreakdown` (`types.ts:74`).** Consider adding a parallel `signalAdjustment: { applied: boolean; baseScore: number; reason: string }` field to `QueuedProduct` so the dashboard can show why a product's final score differs from the breakdown sum. Out of C1 scope as a hard requirement but worth a stub if Doug wants the dashboard side (Phase C task 4) to have data to render.

---

## 9. Handoff to Doug (C1)

**Build:**
- `applySignalAdjustments(baseScore, product, signals)` and `isSignalsFresh(signals)` exported from `src/researcher/scorer.ts`, per §3 / §5.
- `contributingVideoCount` added to `AnalystSignals` (`src/shared/types.ts`) and written by `generateSignals()` (`src/analyst/index.ts`).
- Caller integration in `src/researcher/index.ts`: read signals once, log freshness state once per run, pass through `applySignalAdjustments` per product, store the adjusted score on `QueuedProduct.score`.
- Tests extending `scorer.test.ts` per §6.

**Decisions left open:**
- Whether to expose boost/cap magnitudes (`+10`, `cap 50`) as `config.json` knobs. C1 default: hard-coded. If Doug wants config knobs, add them under `config.scoring.signalAdjustments.{boost, avoidCap}` and default to the values in §4. Backward-compatible.
- Whether to surface the pre-adjustment score in `ResearchLogEntry` for dashboard visibility. Recommended yes (one extra optional field, `baseScoreBeforeSignals?: number`); call before commit if undecided.

**Watch out for:**
- The `selectKeywordsForRun()` function at `src/researcher/index.ts:33-57` *already* consumes `signals.highPerformingCategories` and `signals.avoidCategories` for keyword rotation. This is **complementary**, not duplicative — keyword selection biases what's *searched*, scoring adjustments bias what's *queued from results*. Both layers should engage; no need to refactor either.
- The `meetsMinimumCriteria(shopPerf, score)` gate at `src/researcher/index.ts:159` runs **after** scoring. If signal adjustments produce a score above `minScoreToQueue` for a product whose `shopPerformanceScore` is still below 80 (pilot mode), the criteria gate still rejects — correct behaviour, leave it alone.
- Freezing `signals` in tests will catch accidental mutation; use it.
- `appendError` writes to `state/errors.json` synchronously. One log per run is fine; don't move it inside the per-product loop.
