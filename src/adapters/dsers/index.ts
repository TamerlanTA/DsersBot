import { env } from '../../utils/env.js';
import { logger } from '../../utils/logger.js';

type Mode = 'full' | 'partial' | 'fallback';

export interface DSersProductPayload {
  title: string;
  sourceUrl: string;
  variants: Array<{
    sku?: string;
    price: number;
    optionValues: string[];
  }>;
}

export interface DSersProductResult {
  dsersProductId: string | null;
  mode: Mode;
}

export class DSersClient {
  private readonly mode: Mode;
  private readonly endpoint = 'https://api.dsers.com';

  constructor(mode: Mode = env.DSERS_API_MODE as Mode) {
    this.mode = mode;
  }

  private hasCredentials(): boolean {
    return Boolean(env.DSERS_API_KEY && env.DSERS_API_SECRET);
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.DSERS_API_KEY,
        'x-api-secret': env.DSERS_API_SECRET
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DSers request failed: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  }

  async pushProduct(payload: DSersProductPayload): Promise<DSersProductResult> {
    if (!this.hasCredentials()) {
      logger.info('DSers credentials missing; skipping push');
      return { dsersProductId: null, mode: 'fallback' };
    }
    if (this.mode === 'fallback') {
      return { dsersProductId: null, mode: 'fallback' };
    }
    if (this.mode === 'partial') {
      // Partial mode: register shell product without relying on full catalog access.
      try {
        const data = await this.request<{ productId: string }>(
          '/partner/products/register',
          { title: payload.title, sourceUrl: payload.sourceUrl }
        );
        return { dsersProductId: data.productId, mode: 'partial' };
      } catch (error) {
        logger.warn({ error }, 'DSers partial registration failed; continuing without DSers');
        return { dsersProductId: null, mode: 'fallback' };
      }
    }
    // Full mode: attempt full product push.
    try {
      const data = await this.request<{ productId: string }>('/partner/products/create', payload);
      return { dsersProductId: data.productId, mode: 'full' };
    } catch (error) {
      logger.error({ error }, 'DSers full push failed; reverting to fallback');
      return { dsersProductId: null, mode: 'fallback' };
    }
  }

  async linkShopifyProduct(dsersProductId: string, shopifyProductId: string): Promise<void> {
    if (!dsersProductId) {
      return;
    }
    try {
      await this.request('/partner/products/link-shopify', {
        dsersProductId,
        shopifyProductId
      });
    } catch (error) {
      logger.warn({ error, dsersProductId, shopifyProductId }, 'Failed to link Shopify product in DSers');
    }
  }
}

export function createDsersClient(): DSersClient {
  return new DSersClient(env.DSERS_API_MODE as Mode);
}
