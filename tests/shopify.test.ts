import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '../src/adapters/shopify/index.js';

describe('Shopify adapter', () => {
  it('sends product and variant options as expected', async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          productCreate: {
            product: {
              id: 'gid://shopify/Product/1',
              variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1' }] }
            },
            userErrors: []
          }
        }
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await createProduct({
        title: 'Test Product',
        bodyHtml: '<p>Test</p>',
        options: [
          { name: 'Color', values: ['Red', 'Blue'] },
          { name: 'Size', values: ['S', 'M'] }
        ],
        variants: [
          {
            title: 'Red S',
            price: '10.00',
            compareAtPrice: '15.00',
            sku: 'SKU-1',
            options: ['Red', 'S']
          }
        ]
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse((requestInit?.body as string) ?? '{}');
    expect(body.variables.input.options).toEqual([
      { name: 'Color', values: ['Red', 'Blue'] },
      { name: 'Size', values: ['S', 'M'] }
    ]);
    expect(body.variables.input.variants[0].options).toEqual(['Red', 'S']);
  });
});
