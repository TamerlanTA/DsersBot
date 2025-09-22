# DSers ↔ Shopify Auto-Publishing Bot

Automated Node.js/TypeScript integration that ingests winning products (AliExpress URLs, CSV, Google Sheets, DSers Winning feed), enriches them (pricing, SEO, media), and publishes to `adealtd.com` via Shopify Admin GraphQL API with DSers synchronization and Telegram notifications.

## Architecture Options

```
(A) Full DSers API (auto push + Shopify mirror)
    Sources → Normalizer → DSers push → Shopify publish → Collections/SEO
    Pros: maximum automation, DSers inventory sync.
    Cons: requires full partner access; API volatility.

(B) Partial DSers + Direct Shopify (default)
    Sources → Normalizer → Attempt DSers partial register
            → Shopify publish → Collections/SEO → Optional DSers link job
    Pros: resilient when only subset of DSers endpoints available; Shopify is always authoritative.
    Cons: limited DSers automation; requires later reconciliation jobs.

(C) Shopify-Only Fallback
    Sources → Normalizer → Shopify publish → Manual/late DSers linking
    Pros: works without DSers credentials.
    Cons: inventory sync deferred; more manual effort later.
```

Mode is controlled by `DSERS_API_MODE` (`full`, `partial`, `fallback`). The code defaults to **(B)** and gracefully downgrades to **(C)** whenever DSers keys are missing or calls fail.

## Data Model & Persistence

| Table | Purpose | Key Columns / Indexes |
|-------|---------|------------------------|
| `Source` | Source ingestion bookkeeping & dedupe | `sourceHash` unique, `type+identifier` index |
| `ProductMap` | Links Source ↔ DSers ↔ Shopify | Unique `sourceId`; indexes on `dsersProductId`, `shopifyProductId` |
| `RunLog` | Structured audit trail for each source | Index on `createdAt` |
| `RateLimitState` | Daily throughput counter | Unique `(key, windowStart)` |

### Idempotency Strategy
- `sourceHash = md5(type + identifier + payload)` ensures dedupe across runs.
- BullMQ job `jobId` uses the hash for retry safety.
- Shopify requests use `Idempotency-Key` header (hash of query + variables).
- Media dedupe uses MD5 on URLs.
- RunLog records allow replay/audit.

## Pricing Rules

`RATE_LIMIT_MAX_PER_DAY` defaults to 10. Pricing markup defaults:
- Base markup: `+3%` (no rounding up; truncated to cents).
- Compare-at heuristics (configurable via env or metafields):
  - `< $10` → `+70%`
  - `$10 – $30` → `+50%`
  - `> $30` → `+30%`

## Pipeline Flow

```
Source intake (AliExpress/CSV/Sheets/DSers Winning)
        ↓ normalize()
BullMQ enqueue (idempotent Source record)
        ↓ worker checks rate limit (10/day)
Optional DSers push/register (mode aware)
        ↓ pricing + SEO enrichment (OpenAI or fallback)
Shopify productCreate (+media, metafields)
        ↓ ensure collections (Lifestyle, Home Goods, Beauty & Care, Outdoors, All Products)
Assign collections + publish → Telegram notify → ProductMap write
```

Example end-to-end log for one AliExpress product:
1. `/ingest/aliexpress` POST enqueues product (Source stored, job queued).
2. Worker wakes, verifies <10/day, generates pricing + SEO.
3. Attempts DSers register; if partial/fallback continues.
4. `productCreate` with media + metafields, `collectionAddProductsV2`, `publishablePublish`.
5. Rate limit slot consumed, RunLog appended, Telegram success message sent.

## Rollout Plan

1. **MVP**
   - Manual list of sources (CSV upload / AliExpress URLs).
   - Rate limit 10/day enforced.
   - Detailed RunLog + Telegram alerts.
   - Definition of Done: 0 duplicates, correct markup, media present, collections assigned, Telegram notified.
2. **Beta**
   - Enable DSers Winning cron job (already scaffolded at 07:00 UTC).
   - Google Sheets sync (08:00 UTC) for curated lists.
   - Basic retry dashboards via RunLog querying.
3. **Prod**
   - Tighten DSers linking, add Shopify/DSers webhook reconciliation.
   - Observability integrations (Railway metrics / external logging).
   - Harden secret rotation + periodic audit exports.

## Components

- **Adapters**: Shopify GraphQL client (productCreate, variants, metafields, collections) & DSers client with graceful fallback.
- **Rules**: Pricing heuristics, SEO/description generation (OpenAI, with templated fallback).
- **Ingest**: AliExpress parser, CSV/Sheets importers, DSers Winning fetcher.
- **Jobs**: BullMQ queue backed by Redis; pipeline worker with exponential backoff + jitter.
- **Webhooks**: Shopify `products/create` & `products/update` receiver with HMAC validation.
- **Notifier**: Telegram bot notifications.
- **Database**: Prisma schema targeting Railway Postgres.

## Security Best Practices

- Railway secrets for prod (`SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `DSERS_API_*`, `OPENAI_API_KEY`, `TELEGRAM_*`).
- Principle of least privilege for Shopify app scopes (Product write, Product read, Webhook read/write) and DSers partner keys.
- Rotate secrets quarterly; expose rotation playbook via RunLog metadata.
- Enforce publication guardrails: pipeline aborts if no media or price <= 0 (in code via validations).
- Audit logs persisted in `RunLog`; export regularly to secure storage.
- Webhooks verified with HMAC (raw body + `SHOPIFY_WEBHOOK_SECRET`).

## Deployment (Railway)

1. Fork repo and push to GitHub.
2. On Railway: **New Project → Deploy from GitHub**.
3. Provision Railway Postgres + Redis (click "Add plugin").
4. Set environment variables (see table below) in Railway project → Variables.
5. Run once: `npx prisma migrate deploy` via Railway shell (or CI).
6. Deploy; Railway auto-builds Dockerfile (Node 20 Alpine, `npm run build` + `node dist/index.js`).
7. Configure Railway Cron:
   - `0 7 * * *` → `node dist/index.js cron dsers` (optional; or rely on built-in node-cron already in app).
   - `0 8 * * *` → `node dist/index.js cron sheets` (optional; built-in scheduler also runs once app is online).
8. Setup Shopify webhooks pointing to `https://<railway-domain>/webhooks/shopify/products/create` & `/update` with shared secret.
9. Configure Telegram bot and chat ID (notify on success/failure).

### Local Development

```bash
cp .env.example .env
npm install
npx prisma generate
npm run dev
# in another terminal
npm run test
```

Docker compose provides Postgres + Redis for local testing:

```bash
docker compose up --build
```

Run Prisma migrations locally:

```bash
npx prisma migrate dev --name init
```

## Environment Variables

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime mode |
| `PORT` | No | `3000` | Fastify server port |
| `DATABASE_URL` | **Yes** | — | Postgres connection string (Railway) |
| `REDIS_URL` | **Yes** | `redis://localhost:6379` | Redis for BullMQ |
| `SHOPIFY_STORE` | **Yes** | `adealtd.com` | Shopify store domain |
| `SHOPIFY_API_VERSION` | No | `2025-07` | Admin GraphQL API version |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | **Yes** | — | Admin API token |
| `SHOPIFY_WEBHOOK_SECRET` | **Yes** | — | Webhook shared secret |
| `DSERS_API_KEY` | No | — | DSers partner key |
| `DSERS_API_SECRET` | No | — | DSers partner secret |
| `DSERS_API_MODE` | No | `fallback` | `full` / `partial` / `fallback` |
| `TELEGRAM_BOT_TOKEN` | No | — | Bot token for alerts |
| `TELEGRAM_CHAT_ID` | No | — | Target chat/channel ID |
| `OPENAI_API_KEY` | No | — | Used for SEO/description (fallback if absent) |
| `RATE_LIMIT_MAX_PER_DAY` | No | `10` | Daily product cap |
| `PRICING_*` | No | see `.env.example` | Pricing heuristics |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | — | Path to service account JSON |
| `GOOGLE_SHEETS_ID` | No | — | Sheet ID for catalog |
| `GOOGLE_SHEETS_RANGE` | No | `Products!A:Z` | Range to pull |
| `ALIEXPRESS_COOKIE` | No | — | Optional cookie for scraping |
| `RAILWAY_STATIC_URL` | No | — | Railway assigned domain (used for webhooks) |

Missing secrets trigger `process.emitWarning` at runtime so ops can notice during first boot.

## Testing & Quality Gates

- `npm run test` (Vitest): pricing, SEO, idempotency, and dry-run pipeline.
- Prisma schema validated via `npx prisma validate` (included in CI suggestions).
- Logging via Pino (pretty in dev, JSON in prod).
- Queue/backoff: attempts=5, exponential (1s base) with jitter.

## Files of Interest

- `src/index.ts` – Bootstrap server, cron jobs, ingestion endpoints.
- `src/jobs/pipeline.ts` – BullMQ queue/worker implementing the pipeline.
- `src/adapters/shopify/*` – GraphQL operations (product, variants, collections).
- `src/adapters/dsers/*` – DSers API client with fallback logic.
- `src/ingest/*` – Source importers (AliExpress, CSV, Sheets, DSers Winning).
- `src/rules/pricing.ts`, `src/rules/seo.ts` – Business rules.
- `src/webhooks/shopify.ts` – Shopify webhook validation/processing.
- `prisma/schema.prisma` – Database schema.
- `tests/*.test.ts` – Unit & dry-run tests.

## Operational Notes

- Throughput capped at 10 products/day (`RateLimitState`). Jobs exceeding limit auto-delay by 1 hour.
- Telegram notifications on success/failure (fallback logs if secrets absent).
- Webhooks simply log/audit today; extend to trigger re-enrichment if needed.
- Deploy uses Dockerfile optimized for Railway (build stage, final runtime stage).
- Secrets should be rotated and stored via Railway UI or Vault; `.env` only for local dev.

