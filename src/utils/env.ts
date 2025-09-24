import { config } from 'dotenv';
import { z } from 'zod';

config();

const rawEnv = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: process.env.PORT ?? '3000',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  SHOPIFY_STORE: process.env.SHOPIFY_STORE ?? 'adealtd.com',
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION ?? '2025-07',
  SHOPIFY_ADMIN_ACCESS_TOKEN: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? '',
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET ?? '',
  DSERS_API_KEY: process.env.DSERS_API_KEY ?? '',
  DSERS_API_SECRET: process.env.DSERS_API_SECRET ?? '',
  DSERS_API_MODE: process.env.DSERS_API_MODE ?? 'fallback',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  RATE_LIMIT_MAX_PER_DAY: process.env.RATE_LIMIT_MAX_PER_DAY ?? '10',
  PRICING_BASE_MARKUP_PERCENT: process.env.PRICING_BASE_MARKUP_PERCENT ?? '3',
  PRICING_COMPARE_AT_TIER_LOW: process.env.PRICING_COMPARE_AT_TIER_LOW ?? '70',
  PRICING_COMPARE_AT_TIER_MID: process.env.PRICING_COMPARE_AT_TIER_MID ?? '50',
  PRICING_COMPARE_AT_TIER_HIGH: process.env.PRICING_COMPARE_AT_TIER_HIGH ?? '30',
  PRICING_COMPARE_AT_THRESHOLD_LOW: process.env.PRICING_COMPARE_AT_THRESHOLD_LOW ?? '10',
  PRICING_COMPARE_AT_THRESHOLD_HIGH: process.env.PRICING_COMPARE_AT_THRESHOLD_HIGH ?? '30',
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID ?? '',
  GOOGLE_SHEETS_RANGE: process.env.GOOGLE_SHEETS_RANGE ?? 'Products!A:Z',
  ALIEXPRESS_COOKIE: process.env.ALIEXPRESS_COOKIE ?? '',
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().min(0).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().url(),
  SHOPIFY_STORE: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().min(1),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string(),
  SHOPIFY_WEBHOOK_SECRET: z.string(),
  DSERS_API_KEY: z.string(),
  DSERS_API_SECRET: z.string(),
  DSERS_API_MODE: z.enum(['full', 'partial', 'fallback']).default('fallback'),
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_CHAT_ID: z.string(),
  OPENAI_API_KEY: z.string(),
  RATE_LIMIT_MAX_PER_DAY: z.coerce.number().int().positive().max(50).default(10),
  PRICING_BASE_MARKUP_PERCENT: z.coerce.number().min(0),
  PRICING_COMPARE_AT_TIER_LOW: z.coerce.number().min(0),
  PRICING_COMPARE_AT_TIER_MID: z.coerce.number().min(0),
  PRICING_COMPARE_AT_TIER_HIGH: z.coerce.number().min(0),
  PRICING_COMPARE_AT_THRESHOLD_LOW: z.coerce.number().min(0),
  PRICING_COMPARE_AT_THRESHOLD_HIGH: z.coerce.number().min(0),
  GOOGLE_SHEETS_ID: z.string(),
  GOOGLE_SHEETS_RANGE: z.string(),
  ALIEXPRESS_COOKIE: z.string()
});

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Environment validation failed', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

const secretKeys = [
  'SHOPIFY_ADMIN_ACCESS_TOKEN',
  'SHOPIFY_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'OPENAI_API_KEY',
  'DSERS_API_KEY',
  'DSERS_API_SECRET',
];

for (const key of secretKeys) {
  if (!parsed.data[key as keyof typeof parsed.data]) {
    process.emitWarning(`Environment variable ${key} is not set. Using fallback behaviour.`);
  }
}

export const env = parsed.data;

export type Env = typeof env;
