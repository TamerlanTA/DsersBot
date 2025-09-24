import { describe, expect, it } from 'vitest';
import { applyMarkup, calculatePricing, determineCompareAtPercent } from '../src/rules/pricing.js';

describe('pricing rules', () => {
  it('applies base markup without rounding up', () => {
    const price = applyMarkup(10, 3);
    expect(price).toBeCloseTo(10.3, 2);
  });

  it('selects compare-at percentage based on thresholds', () => {
    expect(determineCompareAtPercent(5)).toBeGreaterThan(60);
    expect(determineCompareAtPercent(15)).toBe(50);
    expect(determineCompareAtPercent(40)).toBe(30);
  });

  it('calculates combined pricing result', () => {
    const result = calculatePricing({ baseCost: 25 });
    expect(result.price).toBeGreaterThan(0);
    expect(result.compareAtPrice).toBeGreaterThan(result.price);
  });
});
