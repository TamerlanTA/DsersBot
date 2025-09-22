import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Generate an MD5 hash of arbitrary content.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Compute an HMAC-SHA256 signature.
 */
export function hmacSha256(secret: string, payload: string | Buffer): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/**
 * Verify a Shopify webhook signature.
 */
export function verifyShopifyWebhookSignature(secret: string, payload: Buffer, headerSignature: string): boolean {
  if (!secret || !headerSignature) {
    return false;
  }
  try {
    const computed = hmacSha256(secret, payload).toString('base64');
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(headerSignature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
