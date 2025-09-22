import { Redis } from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';
import { ensureSourceRecord, recordProductMapping, appendRunLog } from '../utils/idempotency.js';
import { checkRateLimit, consumeSlot } from '../utils/rateLimit.js';
import { prisma } from '../utils/prisma.js';
import type { NormalizedProduct } from '../ingest/types.js';
import { createProduct, ensureCollections, assignCollections, publishProduct, metafieldsSet } from '../adapters/shopify.js';
import { createDsersClient } from '../adapters/dsers.js';
import { calculatePricing } from '../rules/pricing.js';
import { generateContent } from '../rules/seo.js';
import { notifyTelegram } from '../notifier/telegram.js';

export interface ProductJobData {
  normalized: NormalizedProduct;
  sourceId: string;
}

export interface ProductJobResult {
  shopifyProductId: string;
  shopifyVariantIds: string[];
  dsersProductId: string | null;
}

const connection = new Redis(env.REDIS_URL);

export const PRODUCT_QUEUE = 'product-ingest';
export const productQueue = new Queue<ProductJobData>(PRODUCT_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

function jobIdFromSource(normalized: NormalizedProduct): string {
  return `${normalized.source.type}:${normalized.source.identifier}`;
}

export async function enqueueProduct(normalized: NormalizedProduct): Promise<void> {
  const { sourceId, created, hash } = await ensureSourceRecord({
    type: normalized.source.type,
    identifier: normalized.source.identifier,
    payload: normalized.source.payload as unknown
  });
  const existing = await prisma.productMap.findUnique({ where: { sourceId } });
  if (existing?.shopifyProductId) {
    logger.info({ sourceId }, 'Product already processed; skipping enqueue');
    return;
  }
  const rate = await checkRateLimit();
  if (!rate.allowed) {
    logger.warn({ remaining: rate.remaining }, 'Daily rate limit reached; skipping enqueue');
    return;
  }
  await productQueue.add('publish-product', { normalized, sourceId }, { jobId: hash ?? jobIdFromSource(normalized) });
  if (created) {
    await appendRunLog(sourceId, 'info', 'Source queued for processing');
  }
}

async function processJob(job: Job<ProductJobData, ProductJobResult | undefined>): Promise<ProductJobResult | undefined> {
  const { normalized, sourceId } = job.data;
  const rate = await checkRateLimit();
  if (!rate.allowed) {
    await job.moveToDelayed(Date.now() + 60 * 60 * 1000);
    logger.info({ sourceId }, 'Rate limit reached, delaying job by 1 hour');
    return undefined;
  }

  try {
    if (normalized.variants.length === 0) {
      throw new Error('Normalized product must contain at least one variant');
    }

    const fallbackBaseCost =
      normalized.variants.find((variant) => typeof variant.price === 'number' && variant.price > 0)?.price ?? 1;
    const variantPricing = normalized.variants.map((variant) => {
      const baseCost = typeof variant.price === 'number' && variant.price > 0 ? variant.price : fallbackBaseCost;
      return calculatePricing({ baseCost });
    });
    const content = await generateContent({
      title: normalized.title,
      attributes: normalized.attributes,
      benefits: normalized.tags,
      tone: 'Conversational'
    });

    const dsersClient = createDsersClient();
    const dsersResult = await dsersClient.pushProduct({
      title: normalized.title,
      sourceUrl: (normalized.source.payload as { url?: string })?.url ?? normalized.title,
      variants: normalized.variants.map((variant, index) => ({
        sku: variant.sku,
        price: variantPricing[index].price,
        optionValues: variant.options.map((option) => option.value)
      }))
    });

    const images = normalized.images.map((image, index) => ({
      originalSource: image.url,
      alt: content.altTexts[index] ?? `${normalized.title} image ${index + 1}`
    }));

    const product = await createProduct({
      title: normalized.title,
      bodyHtml: content.descriptionHtml,
      vendor: normalized.vendor ?? 'ADEALTD',
      productType: normalized.productType ?? 'Lifestyle',
      tags: normalized.tags ?? [],
      variants: normalized.variants.map((variant, index) => {
        const pricing = variantPricing[index];
        return {
          title: variant.title,
          price: pricing.price.toString(),
          compareAtPrice: pricing.compareAtPrice.toString(),
          sku: variant.sku ?? undefined,
          inventoryPolicy: variant.inventoryPolicy ?? 'CONTINUE',
          selectedOptions: variant.options
        };
      }),
      media: images,
      seo: {
        title: content.seoTitle,
        description: content.seoDescription
      },
      metafields: [
        {
          namespace: 'pricing',
          key: 'markup_percent',
          type: 'single_line_text_field',
          value: variantPricing[0].markupPercent.toString()
        },
        {
          namespace: 'pricing',
          key: 'compare_at_percent',
          type: 'single_line_text_field',
          value: variantPricing[0].compareAtPercent.toString()
        }
      ]
    });

    const collections = await ensureCollections();
    await assignCollections(product.productId, Object.values(collections).map((collection) => collection.id));
    await publishProduct(product.productId);

    await metafieldsSet(product.productId, [
      {
        namespace: 'dsers',
        key: 'integration_mode',
        type: 'single_line_text_field',
        value: dsersResult.mode
      }
    ]);

    await recordProductMapping(sourceId, {
      dsersProductId: dsersResult.dsersProductId,
      shopifyProductId: product.productId,
      variantMap: { shopify: product.variantIds }
    });

    await notifyTelegram(`✅ Product published: ${normalized.title}\nShopify ID: ${product.productId}`);
    await appendRunLog(sourceId, 'info', 'Product published successfully', {
      shopifyProductId: product.productId,
      dsersProductId: dsersResult.dsersProductId
    });

    await consumeSlot();

    return {
      shopifyProductId: product.productId,
      shopifyVariantIds: product.variantIds,
      dsersProductId: dsersResult.dsersProductId
    };
  } catch (error) {
    logger.error({ error, sourceId }, 'Pipeline processing failed');
    await appendRunLog(sourceId, 'error', 'Pipeline failure', { error: String(error) });
    throw error;
  }
}

export const productWorker = new Worker<ProductJobData, ProductJobResult | undefined>(PRODUCT_QUEUE, processJob, {
  connection,
  concurrency: 2
});

productWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
});

productWorker.on('completed', (job, result) => {
  logger.info({ jobId: job?.id, result }, 'Job completed');
});
