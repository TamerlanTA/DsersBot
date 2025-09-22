import { startOfDay } from 'date-fns';
import { prisma } from './prisma.js';
import { env } from './env.js';
import { logger } from './logger.js';

const RATE_LIMIT_KEY = 'product-pipeline';

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  processed: number;
  limit: number;
}

async function getState(date: Date) {
  const windowStart = startOfDay(date);
  const existing = await prisma.rateLimitState.findUnique({
    where: {
      key_windowStart: {
        key: RATE_LIMIT_KEY,
        windowStart
      }
    }
  });
  if (existing) {
    return existing;
  }
  return prisma.rateLimitState.create({
    data: {
      key: RATE_LIMIT_KEY,
      windowStart,
      processed: 0
    }
  });
}

export async function checkRateLimit(date: Date = new Date()): Promise<RateLimitStatus> {
  const state = await getState(date);
  const limit = env.RATE_LIMIT_MAX_PER_DAY;
  const remaining = Math.max(limit - state.processed, 0);
  return {
    allowed: remaining > 0,
    remaining,
    processed: state.processed,
    limit
  };
}

export async function consumeSlot(date: Date = new Date()): Promise<RateLimitStatus> {
  const windowStart = startOfDay(date);
  const limit = env.RATE_LIMIT_MAX_PER_DAY;
  const state = await prisma.rateLimitState.upsert({
    where: {
      key_windowStart: {
        key: RATE_LIMIT_KEY,
        windowStart
      }
    },
    update: {
      processed: {
        increment: 1
      }
    },
    create: {
      key: RATE_LIMIT_KEY,
      windowStart,
      processed: 1
    }
  });
  const remaining = Math.max(limit - state.processed, 0);
  if (remaining < 0) {
    logger.warn({ processed: state.processed }, 'Rate limit exceeded');
  }
  return {
    allowed: state.processed <= limit,
    remaining,
    processed: state.processed,
    limit
  };
}
