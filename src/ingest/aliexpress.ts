import { hashContent } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { env } from '../utils/env.js';
import type { NormalizedProduct, RawSource } from './types.js';

interface AliExpressOptions {
  fallbackTitle?: string;
  fallbackPrice?: number;
}

function parseIdentifier(url: string): string {
  const match = url.match(/(\d+)\.html/);
  return match ? match[1] : hashContent(url).slice(0, 12);
}

export async function normalizeAliExpress(url: string, options: AliExpressOptions = {}): Promise<NormalizedProduct> {
  const identifier = parseIdentifier(url);
  let title = options.fallbackTitle ?? 'AliExpress Product';
  let price = options.fallbackPrice ?? 10;
  const attributes: { name: string; value: string }[] = [];
  const images: { url: string; alt?: string }[] = [];

  try {
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 ShopifyBot/1.0' };
    if (env.ALIEXPRESS_COOKIE) {
      headers.Cookie = env.ALIEXPRESS_COOKIE;
    }
    const response = await fetch(url, { headers });
    if (response.ok) {
      const html = await response.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].replace(/AliExpress\.com\s*:/i, '').trim();
      }
      const priceMatch = html.match(/"salePrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1]);
      }
      const imageMatches = Array.from(html.matchAll(/https?:[^"']+\.jpg/g)).slice(0, 8);
      for (const match of imageMatches) {
        images.push({ url: match[0] });
      }
      attributes.push({ name: 'Source', value: 'AliExpress' });
    } else {
      logger.warn({ status: response.status }, 'AliExpress fetch failed; using fallback data');
    }
  } catch (error) {
    logger.warn({ error }, 'AliExpress fetch threw; using fallback data');
  }

  if (!images.length) {
    images.push({ url: 'https://via.placeholder.com/800?text=AliExpress+Product' });
  }

  const source: RawSource = {
    type: 'aliexpress',
    identifier,
    payload: { url }
  };

  return {
    source,
    title,
    attributes,
    description: undefined,
    vendor: 'AliExpress Supplier',
    productType: 'Lifestyle',
    tags: ['AliExpress'],
    options: [{ name: 'Default', values: ['Standard'] }],
    variants: [
      {
        title,
        price,
        options: [{ name: 'Default', value: 'Standard' }],
        inventoryPolicy: 'CONTINUE'
      }
    ],
    images
  };
}
