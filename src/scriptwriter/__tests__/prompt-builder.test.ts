import { describe, it, expect, vi } from 'vitest';

// Mock config so loadSharedFile resolves shared/*.md files from the real project root.
vi.mock('../../shared/config.js', () => ({
  getProjectRoot: () => '/Users/macmini/projects/TT_Auto',
}));

import { buildScriptPrompt } from '../prompt-builder.js';
import type { AnalystSignals, AssetManifest, ProductCategory, VideoFormat } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<AssetManifest> = {}): AssetManifest {
  return {
    productId: 'test-product-001',
    productName: 'Test Vitamin C Supplement',
    productUrl: 'https://tiktokshop.com/product/test',
    sellerName: 'HealthShop',
    price: '$9.99',
    commissionRate: 0.20,
    description: 'A high-quality vitamin C supplement for daily immune support.',
    keyBenefits: ['immune support', 'antioxidant protection', 'energy boost'],
    ingredientsOrSpecs: ['500mg Vitamin C', 'Rose Hip Extract'],
    topReviews: [
      { rating: 5, text: 'Love this supplement!', reviewerName: 'Jane D.', isVerified: true },
    ],
    images: ['/output/assets/test-product-001/img1.jpg', '/output/assets/test-product-001/img2.jpg'],
    hasVideo: false,
    videoPath: '',
    assetQualityScore: 80,
    collectedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create fresh signals — updatedAt is now, contributingVideoCount >= 3.
 * All freshness checks in isSignalsFresh() will pass.
 */
function makeFreshSignals(overrides: Partial<AnalystSignals> = {}): AnalystSignals {
  return {
    updatedAt: new Date().toISOString(),
    highPerformingCategories: [],
    avoidCategories: [],
    winningFormats: [],
    winningHookPatterns: [],
    minCommissionRateThreshold: 0,
    contributingVideoCount: 5,
    notes: '',
    ...overrides,
  };
}

/**
 * Create stale signals — updatedAt is 20 days ago, so isSignalsFresh() returns false.
 */
function makeStaleSignals(overrides: Partial<AnalystSignals> = {}): AnalystSignals {
  const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  return makeFreshSignals({ updatedAt: staleDate, ...overrides });
}

const CATEGORY: ProductCategory = 'supplements';
const FORMAT: VideoFormat = 'voiceover';
const DURATION = 20;

const INJECTION_HEADING = '## Recent Winning Hook Patterns (use as inspiration when relevant)';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildScriptPrompt — hook pattern injection', () => {
  it('injects exactly 3 exemplars when signals are fresh and 5 patterns are provided', () => {
    const signals = makeFreshSignals({
      winningHookPatterns: [
        'PATTERN_ONE: fatigue hack that actually works',
        'PATTERN_TWO: vitamin changed my energy in 2 weeks',
        'PATTERN_THREE: everyone buying this supplement now',
        'PATTERN_FOUR: should not appear in prompt',
        'PATTERN_FIVE: also should not appear in prompt',
      ],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    // Heading must be present
    expect(prompt).toContain(INJECTION_HEADING);

    // Exactly the first 3 patterns appear as bullet points
    expect(prompt).toContain('- PATTERN_ONE: fatigue hack that actually works');
    expect(prompt).toContain('- PATTERN_TWO: vitamin changed my energy in 2 weeks');
    expect(prompt).toContain('- PATTERN_THREE: everyone buying this supplement now');

    // The 4th and 5th patterns must NOT appear
    expect(prompt).not.toContain('PATTERN_FOUR');
    expect(prompt).not.toContain('PATTERN_FIVE');
  });

  it('does NOT inject the section when winningHookPatterns is empty', () => {
    const signals = makeFreshSignals({ winningHookPatterns: [] });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    expect(prompt).not.toContain(INJECTION_HEADING);
  });

  it('does NOT inject the section when signals are stale (>14 days old)', () => {
    const signals = makeStaleSignals({
      winningHookPatterns: [
        'This pattern should not appear because signals are stale',
      ],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    expect(prompt).not.toContain(INJECTION_HEADING);
    expect(prompt).not.toContain('This pattern should not appear because signals are stale');
  });

  it('does NOT inject the section when signals are stale due to low contributingVideoCount', () => {
    const signals = makeFreshSignals({
      contributingVideoCount: 2, // below the minimum of 3
      winningHookPatterns: ['Pattern that should not appear due to insufficient sample'],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    expect(prompt).not.toContain(INJECTION_HEADING);
    expect(prompt).not.toContain('Pattern that should not appear');
  });

  it('does NOT inject the section when signals is null', () => {
    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, null);

    expect(prompt).not.toContain(INJECTION_HEADING);
  });

  it('does NOT inject the section when signals parameter is omitted (backward compat)', () => {
    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION);

    expect(prompt).not.toContain(INJECTION_HEADING);
  });

  it('truncates each exemplar to 200 characters when a pattern exceeds the cap', () => {
    const longPattern = 'A'.repeat(300); // 300 chars — well over the 200-char cap
    const signals = makeFreshSignals({
      winningHookPatterns: [longPattern],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    // The injection section must still appear
    expect(prompt).toContain(INJECTION_HEADING);

    // The bullet line should contain exactly 200 'A' chars (the truncated exemplar)
    // The bullet prefix is '- ' (2 chars), so the full bullet is '- ' + 'A'.repeat(200)
    const expectedBullet = `- ${'A'.repeat(200)}`;
    expect(prompt).toContain(expectedBullet);

    // No 201st 'A' should appear in any bullet (i.e., 'A'.repeat(201) must not be present)
    expect(prompt).not.toContain('A'.repeat(201));
  });

  it('injects fewer than 3 exemplars when fewer than 3 patterns exist', () => {
    const signals = makeFreshSignals({
      winningHookPatterns: [
        'Only one pattern available',
      ],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    expect(prompt).toContain(INJECTION_HEADING);
    expect(prompt).toContain('- Only one pattern available');
  });

  it('injection appears between Hook Formulas section and CRITICAL RULES section', () => {
    const signals = makeFreshSignals({
      winningHookPatterns: ['A pattern that should land between formulas and critical rules'],
    });

    const prompt = buildScriptPrompt(makeManifest(), FORMAT, CATEGORY, DURATION, signals);

    const hookFormulasPos = prompt.indexOf('## Hook Formulas');
    const injectionPos = prompt.indexOf(INJECTION_HEADING);
    const criticalRulesPos = prompt.indexOf('## CRITICAL RULES');

    expect(hookFormulasPos).toBeGreaterThan(-1);
    expect(injectionPos).toBeGreaterThan(-1);
    expect(criticalRulesPos).toBeGreaterThan(-1);

    // Injection must come after Hook Formulas and before CRITICAL RULES
    expect(injectionPos).toBeGreaterThan(hookFormulasPos);
    expect(injectionPos).toBeLessThan(criticalRulesPos);
  });
});
