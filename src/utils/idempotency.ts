import { prisma } from './prisma.js';
import { hashContent } from './crypto.js';
import { logger } from './logger.js';

export interface SourceInput {
  type: string;
  identifier: string;
  payload: unknown;
}

export interface SourceRecordResult {
  sourceId: string;
  created: boolean;
  hash: string;
}

/**
 * Ensure a Source record exists and provide idempotent behaviour.
 */
export async function ensureSourceRecord(input: SourceInput): Promise<SourceRecordResult> {
  const hash = hashContent(JSON.stringify({ type: input.type, identifier: input.identifier, payload: input.payload }));
  const existing = await prisma.source.findUnique({ where: { sourceHash: hash } });
  if (existing) {
    return { sourceId: existing.id, created: false, hash };
  }
  const record = await prisma.source.create({
    data: {
      type: input.type,
      identifier: input.identifier,
      payload: input.payload as any,
      sourceHash: hash
    }
  });
  logger.info({ sourceId: record.id, type: input.type }, 'Created new source record');
  return { sourceId: record.id, created: true, hash };
}

export async function recordProductMapping(sourceId: string, data: { dsersProductId?: string | null; shopifyProductId?: string | null; variantMap?: unknown; }): Promise<void> {
  await prisma.productMap.upsert({
    where: { sourceId },
    update: {
      dsersProductId: data.dsersProductId ?? undefined,
      shopifyProductId: data.shopifyProductId ?? undefined,
      variantMap: (data.variantMap ?? undefined) as any
    },
    create: {
      sourceId,
      dsersProductId: data.dsersProductId ?? null,
      shopifyProductId: data.shopifyProductId ?? null,
      variantMap: (data.variantMap ?? null) as any
    }
  });
}

export async function appendRunLog(sourceId: string | null, level: 'info' | 'warn' | 'error', message: string, meta?: unknown): Promise<void> {
  await prisma.runLog.create({
    data: {
      sourceId: sourceId ?? undefined,
      level,
      message,
      meta: (meta ?? undefined) as any
    }
  });
}
