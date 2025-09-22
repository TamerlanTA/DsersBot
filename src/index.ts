import Fastify from 'fastify';
import cron from 'node-cron';
import { env } from './utils/env.js';
import { logger } from './utils/logger.js';
import { registerShopifyWebhooks } from './webhooks/shopify.js';
import { enqueueProduct, productWorker } from './jobs/pipeline.js';
import { checkRateLimit } from './utils/rateLimit.js';
import { normalizeAliExpress } from './ingest/aliexpress.js';
import { importFromCsv } from './ingest/csv.js';
import { importFromSheets } from './ingest/sheets.js';
import { fetchDsersWinningProducts } from './ingest/dsersWinning.js';
import { ensureCollections } from './adapters/shopify.js';

async function bootstrap() {
  const app = Fastify({ logger: false });
  await registerShopifyWebhooks(app);

  app.get('/healthz', async () => ({
    status: 'ok',
    mode: env.DSERS_API_MODE,
    rateLimit: await checkRateLimit()
  }));

  app.post('/ingest/aliexpress', async (request, reply) => {
    const body = request.body as { url: string; title?: string; price?: number };
    const normalized = await normalizeAliExpress(body.url, {
      fallbackTitle: body.title,
      fallbackPrice: body.price
    });
    await enqueueProduct(normalized);
    reply.status(202).send({ status: 'queued' });
  });

  app.post('/ingest/csv', async (request, reply) => {
    const body = request.body as { content: string };
    const products = importFromCsv({ content: body.content });
    await Promise.all(products.map((product) => enqueueProduct(product)));
    reply.status(202).send({ status: 'queued', count: products.length });
  });

  app.post('/ingest/sheets', async (_request, reply) => {
    const products = await importFromSheets();
    await Promise.all(products.map((product) => enqueueProduct(product)));
    reply.status(202).send({ status: 'queued', count: products.length });
  });

  await ensureCollections();

  cron.schedule('0 7 * * *', async () => {
    logger.info('Running DSers winning product fetch job');
    const products = await fetchDsersWinningProducts(2);
    for (const product of products) {
      await enqueueProduct(product);
    }
  });

  cron.schedule('0 8 * * *', async () => {
    logger.info('Running Google Sheets import job');
    const products = await importFromSheets();
    for (const product of products) {
      await enqueueProduct(product);
    }
  });

  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ address }, 'Server ready');
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to bootstrap application');
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down');
  await productWorker.close();
  process.exit(0);
});
