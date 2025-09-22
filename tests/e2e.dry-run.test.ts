import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '../src/ingest/types.js';

declare global {
  // eslint-disable-next-line no-var
  var __mockWorker: any;
  var __queueJobs: any[];
  var __prismaRateLimit: Map<string, any>;
  var __prismaSources: Map<string, any>;
  var __prismaProductMaps: Map<string, any>;
  var __dsersPushPayloads: any[];
  var __shopifyCreatePayloads: any[];
}

vi.mock('ioredis', () => {
  return {
    Redis: class MockRedis {
      quit() {
        return Promise.resolve();
      }
    }
  };
});

vi.mock('bullmq', () => {
  class MockQueue {
    name: string;
    options: any;
    constructor(name: string, options: any) {
      this.name = name;
      this.options = options;
      globalThis.__queueJobs = [];
    }
    async add(name: string, data: any, opts: any) {
      globalThis.__queueJobs.push({ name, data, opts });
    }
  }
  class MockQueueScheduler {
    constructor() {}
  }
  class MockWorker {
    processor: any;
    constructor(_name: string, processor: any) {
      this.processor = processor;
      globalThis.__mockWorker = this;
    }
    on() {}
    async close() {}
  }
  return { Queue: MockQueue, QueueScheduler: MockQueueScheduler, Worker: MockWorker, Job: class {} };
});

vi.mock('../src/utils/prisma.js', () => {
  const sources = new Map<string, any>();
  const productMaps = new Map<string, any>();
  const rateLimits = new Map<string, any>();
  globalThis.__prismaSources = sources;
  globalThis.__prismaProductMaps = productMaps;
  globalThis.__prismaRateLimit = rateLimits;

  return {
    prisma: {
      source: {
        findUnique: vi.fn(async ({ where }: any) => {
          return Array.from(sources.values()).find((record) => record.sourceHash === where.sourceHash) ?? null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const record = { ...data, id: data.sourceHash };
          sources.set(record.id, record);
          return record;
        })
      },
      productMap: {
        findUnique: vi.fn(async ({ where }: any) => productMaps.get(where.sourceId) ?? null),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const current = productMaps.get(where.sourceId);
          if (current) {
            const updated = { ...current, ...update };
            productMaps.set(where.sourceId, updated);
            return updated;
          }
          productMaps.set(where.sourceId, create);
          return create;
        })
      },
      runLog: {
        create: vi.fn(async () => ({}))
      },
      rateLimitState: {
        findUnique: vi.fn(async ({ where }: any) => rateLimits.get(`${where.key_windowStart.key}:${where.key_windowStart.windowStart.toISOString()}`) ?? null),
        create: vi.fn(async ({ data }: any) => {
          const key = `${data.key}:${data.windowStart.toISOString()}`;
          rateLimits.set(key, data);
          return data;
        }),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const key = `${where.key_windowStart.key}:${where.key_windowStart.windowStart.toISOString()}`;
          const existing = rateLimits.get(key);
          if (existing) {
            const next = { ...existing, processed: existing.processed + 1 };
            rateLimits.set(key, next);
            return next;
          }
          rateLimits.set(key, create);
          return create;
        })
      }
    }
  };
});

vi.mock('../src/notifier/telegram.js', () => ({ notifyTelegram: vi.fn(async () => {}) }));

vi.mock('../src/adapters/shopify.js', () => {
  const createProduct = vi.fn(async (payload: any) => {
    globalThis.__shopifyCreatePayloads = globalThis.__shopifyCreatePayloads ?? [];
    globalThis.__shopifyCreatePayloads.push(payload);
    return { productId: 'gid://shopify/Product/1', variantIds: ['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/2'] };
  });

  return {
    createProduct,
    ensureCollections: vi.fn(async () => ({ Lifestyle: { id: 'gid://shopify/Collection/1', title: 'Lifestyle' } })),
    assignCollections: vi.fn(async () => {}),
    publishProduct: vi.fn(async () => {}),
    metafieldsSet: vi.fn(async () => {}),
    collectionNames: vi.fn(() => ['Lifestyle'])
  };
});

vi.mock('../src/adapters/dsers.js', () => {
  const pushProduct = vi.fn(async (payload: any) => {
    globalThis.__dsersPushPayloads = globalThis.__dsersPushPayloads ?? [];
    globalThis.__dsersPushPayloads.push(payload);
    return { dsersProductId: 'dsers-1', mode: 'partial' };
  });

  return {
    createDsersClient: () => ({
      pushProduct,
      linkShopifyProduct: async () => {}
    })
  };
});

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'skip' }));
});

describe('pipeline dry run', () => {
  it('enqueues and processes a normalized product', async () => {
    const { enqueueProduct } = await import('../src/jobs/pipeline.js');
    const normalized: NormalizedProduct = {
      source: { type: 'csv', identifier: 'dry-run', payload: { url: 'https://example.com' } },
      title: 'Dry Run Product',
      attributes: [{ name: 'Feature', value: 'Value' }],
      options: [{ name: 'Default', values: ['Standard', 'Deluxe'] }],
      variants: [
        {
          title: 'Dry Run Standard',
          price: 12,
          sku: 'STD-1',
          options: [{ name: 'Default', value: 'Standard' }],
          inventoryPolicy: 'CONTINUE'
        },
        {
          title: 'Dry Run Deluxe',
          price: 30,
          sku: 'DLX-1',
          options: [{ name: 'Default', value: 'Deluxe' }],
          inventoryPolicy: 'CONTINUE'
        }
      ],
      images: [{ url: 'https://example.com/image.jpg' }],
      tags: ['Test'],
      vendor: 'Test Vendor',
      productType: 'General'
    };

    await enqueueProduct(normalized);
    expect(globalThis.__queueJobs).toHaveLength(1);

    const worker = globalThis.__mockWorker;
    expect(worker).toBeDefined();
    const jobData = globalThis.__queueJobs[0].data;
    await worker.processor({
      data: jobData,
      moveToDelayed: async () => {}
    });

    expect(globalThis.__prismaProductMaps.size).toBe(1);
    const dsersPayload = globalThis.__dsersPushPayloads?.[0];
    expect(dsersPayload).toBeDefined();
    expect(dsersPayload.variants).toHaveLength(2);
    expect(dsersPayload.variants[0].price).toBeCloseTo(12.36, 2);
    expect(dsersPayload.variants[1].price).toBeCloseTo(30.9, 2);

    const shopifyPayload = globalThis.__shopifyCreatePayloads?.[0];
    expect(shopifyPayload).toBeDefined();
    expect(shopifyPayload.variants[0].price).toBe('12.36');
    expect(shopifyPayload.variants[1].price).toBe('30.9');
  });
});
