import { describe, it, expect } from 'vitest';
import { selectFormat } from '../format-selector.js';
import type { ProductCategory } from '../../shared/types.js';

describe('selectFormat', () => {
  it('maps supplements to voiceover format with 20s duration', () => {
    const result = selectFormat('supplements');
    expect(result.format).toBe('voiceover');
    expect(result.durationTarget).toBe(20);
  });

  it('maps fitness-tools to demo format with 30s duration', () => {
    const result = selectFormat('fitness-tools');
    expect(result.format).toBe('demo');
    expect(result.durationTarget).toBe(30);
  });

  it('maps recovery to demo format with 30s duration', () => {
    const result = selectFormat('recovery');
    expect(result.format).toBe('demo');
    expect(result.durationTarget).toBe(30);
  });

  it('maps sleep-wellness to hook-text format with 20s duration', () => {
    const result = selectFormat('sleep-wellness');
    expect(result.format).toBe('hook-text');
    expect(result.durationTarget).toBe(20);
  });

  it('maps weight-management to voiceover-before-after format with 25s duration', () => {
    const result = selectFormat('weight-management');
    expect(result.format).toBe('voiceover-before-after');
    expect(result.durationTarget).toBe(25);
  });

  it('maps general-health to voiceover format with 20s duration', () => {
    const result = selectFormat('general-health');
    expect(result.format).toBe('voiceover');
    expect(result.durationTarget).toBe(20);
  });

  it('covers all ProductCategory values', () => {
    const allCategories: ProductCategory[] = [
      'supplements',
      'fitness-tools',
      'recovery',
      'sleep-wellness',
      'weight-management',
      'general-health',
    ];
    for (const category of allCategories) {
      const result = selectFormat(category);
      expect(result.format).toBeTruthy();
      expect(result.durationTarget).toBeGreaterThan(0);
    }
  });
});
