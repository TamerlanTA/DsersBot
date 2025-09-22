import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { verifyShopifyWebhookSignature } from '../utils/crypto.js';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { appendRunLog } from '../utils/idempotency.js';

interface ShopifyProductWebhookPayload {
  id: number;
  admin_graphql_api_id?: string;
  title: string;
  handle?: string;
}

async function handleProductWebhook(payload: ShopifyProductWebhookPayload, topic: string): Promise<void> {
  const graphqlId = payload.admin_graphql_api_id ?? `gid://shopify/Product/${payload.id}`;
  const mapping = await prisma.productMap.findFirst({ where: { shopifyProductId: graphqlId } });
  const sourceId = mapping?.sourceId ?? null;
  await appendRunLog(sourceId, 'info', `Webhook received: ${topic}`, payload as unknown as Record<string, unknown>);
}

export async function registerShopifyWebhooks(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    runFirst: true,
    encoding: 'utf8'
  });

  app.post('/webhooks/shopify/products/:event', { config: { rawBody: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const event = (request.params as { event: string }).event;
    const signature = request.headers['x-shopify-hmac-sha256'];
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? '';

    if (!verifyShopifyWebhookSignature(env.SHOPIFY_WEBHOOK_SECRET, Buffer.from(rawBody), String(signature ?? ''))) {
      logger.warn('Invalid Shopify webhook signature');
      reply.status(401).send('invalid signature');
      return;
    }

    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    await handleProductWebhook(body as ShopifyProductWebhookPayload, event);

    reply.status(200).send('ok');
  });
}
