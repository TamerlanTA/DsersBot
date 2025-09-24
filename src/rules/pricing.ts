import { env } from '../utils/env.js';

export interface PricingInput {
  baseCost: number;
  currency?: string;
}

export interface PricingResult {
  price: number;
  compareAtPrice: number;
  markupPercent: number;
  compareAtPercent: number;
}

function truncateToCents(value: number): number {
  return Math.trunc(value * 100) / 100;
}

export function applyMarkup(baseCost: number, markupPercent: number): number {
  if (baseCost <= 0) {
    throw new Error('Base cost must be positive');
  }
  const multiplier = 1 + markupPercent / 100;
  return truncateToCents(baseCost * multiplier);
}

export function determineCompareAtPercent(price: number): number {
  if (price < env.PRICING_COMPARE_AT_THRESHOLD_LOW) {
    return env.PRICING_COMPARE_AT_TIER_LOW;
  }
  if (price < env.PRICING_COMPARE_AT_THRESHOLD_HIGH) {
    return env.PRICING_COMPARE_AT_TIER_MID;
  }
  return env.PRICING_COMPARE_AT_TIER_HIGH;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const markupPercent = env.PRICING_BASE_MARKUP_PERCENT;
  const price = applyMarkup(input.baseCost, markupPercent);
  const compareAtPercent = determineCompareAtPercent(price);
  const compareAtPrice = truncateToCents(price * (1 + compareAtPercent / 100));
  return { price, compareAtPrice, markupPercent, compareAtPercent };
}
