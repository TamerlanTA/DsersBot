import { createDsersClient } from '../adapters/dsers.js';
import { hashContent } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import type { NormalizedProduct, RawSource } from './types.js';

interface WinningProductApiResponse {
  id: string;
  title: string;
  image: string;
  price: number;
  sourceUrl: string;
}

export async function fetchDsersWinningProducts(limit = 5): Promise<NormalizedProduct[]> {
  const client = createDsersClient();
  if (!('request' in client)) {
    return [];
  }
  try {
    const response = await fetch('https://api.dsers.com/partner/winning-products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.DSERS_API_KEY ?? '',
        'x-api-secret': process.env.DSERS_API_SECRET ?? ''
      },
      body: JSON.stringify({ limit })
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to retrieve DSers winning products');
      return [];
    }
    const data = (await response.json()) as { items: WinningProductApiResponse[] };
    return data.items.slice(0, limit).map((item) => normalizeWinningProduct(item));
  } catch (error) {
    logger.warn({ error }, 'DSers winning products request threw');
    return [];
  }
}

function normalizeWinningProduct(item: WinningProductApiResponse): NormalizedProduct {
  const source: RawSource = {
    type: 'dsers-winning',
    identifier: item.id,
    payload: item
  };
  return {
    source,
    title: item.title,
    vendor: 'DSers',
    productType: 'General',
    attributes: [
      { name: 'Source', value: 'DSers Winning' },
      { name: 'Source URL', value: item.sourceUrl }
    ],
    tags: ['DSers'],
    options: [{ name: 'Default', values: ['Standard'] }],
    variants: [
      {
        title: item.title,
        price: item.price,
        options: [{ name: 'Default', value: 'Standard' }],
        inventoryPolicy: 'CONTINUE'
      }
    ],
    images: [{ url: item.image }],
    description: undefined
  };
}

export function normalizeWinningFallback(title: string, price: number, image: string, sourceUrl: string): NormalizedProduct {
  const payload = { id: hashContent(`${title}-${price}`), title, price, image, sourceUrl };
  return normalizeWinningProduct(payload);
}
