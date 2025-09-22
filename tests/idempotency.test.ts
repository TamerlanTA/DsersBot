import { beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var __prismaState: {
    sources: Map<string, any>;
    productMaps: Map<string, any>;
    runLogs: any[];
  };
}

vi.mock('../src/utils/prisma.js', () => {
  const sources = new Map<string, any>();
  const productMaps = new Map<string, any>();
  const runLogs: any[] = [];
  globalThis.__prismaState = { sources, productMaps, runLogs };

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
        findUnique: vi.fn(async ({ where }: any) => {
          return productMaps.get(where.sourceId) ?? null;
        }),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const existing = productMaps.get(where.sourceId);
          if (existing) {
            const updated = { ...existing, ...update };
            productMaps.set(where.sourceId, updated);
            return updated;
          }
          productMaps.set(where.sourceId, create);
          return create;
        })
      },
      runLog: {
        create: vi.fn(async ({ data }: any) => {
          runLogs.push(data);
          return data;
        })
      }
    }
  };
});

describe('idempotency utilities', () => {
  beforeEach(() => {
    if (!globalThis.__prismaState) {
      globalThis.__prismaState = {
        sources: new Map(),
        productMaps: new Map(),
        runLogs: []
      };
    }
    globalThis.__prismaState.sources.clear();
    globalThis.__prismaState.productMaps.clear();
    globalThis.__prismaState.runLogs.length = 0;
  });

  it('creates a source once and reuses it for duplicates', async () => {
    const { ensureSourceRecord } = await import('../src/utils/idempotency.js');
    const first = await ensureSourceRecord({ type: 'csv', identifier: '1', payload: { foo: 'bar' } });
    const second = await ensureSourceRecord({ type: 'csv', identifier: '1', payload: { foo: 'bar' } });
    expect(first.sourceId).toBe(second.sourceId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('stores product mapping as json', async () => {
    const { ensureSourceRecord, recordProductMapping } = await import('../src/utils/idempotency.js');
    const source = await ensureSourceRecord({ type: 'csv', identifier: '2', payload: { foo: 'baz' } });
    await recordProductMapping(source.sourceId, { shopifyProductId: 'gid://shopify/Product/1', variantMap: { variants: [1, 2] } });
    expect(globalThis.__prismaState.productMaps.get(source.sourceId)?.shopifyProductId).toContain('Product/1');
  });

  it('appends run logs', async () => {
    const { appendRunLog } = await import('../src/utils/idempotency.js');
    await appendRunLog(null, 'info', 'Hello');
    expect(globalThis.__prismaState.runLogs).toHaveLength(1);
  });
});
