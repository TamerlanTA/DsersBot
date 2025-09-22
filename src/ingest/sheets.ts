import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import { env } from '../utils/env.js';
import { hashContent } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import type { NormalizedProduct, RawSource } from './types.js';

interface SheetsOptions {
  sheetId?: string;
  range?: string;
  fallbackRows?: string[][];
}

async function getSheetsClient() {
  try {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) {
      return null;
    }
    const content = await readFile(credentialsPath, 'utf-8');
    const json = JSON.parse(content) as { client_email: string; private_key: string };
    const auth = new google.auth.JWT(json.client_email, undefined, json.private_key, [
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]);
    await auth.authorize();
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize Google Sheets client');
    return null;
  }
}

export async function importFromSheets(options: SheetsOptions = {}): Promise<NormalizedProduct[]> {
  const sheetId = options.sheetId ?? env.GOOGLE_SHEETS_ID;
  const range = options.range ?? env.GOOGLE_SHEETS_RANGE;
  const rows: string[][] = [];
  const sheets = await getSheetsClient();

  if (sheets && sheetId) {
    try {
      const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
      const values = response.data.values ?? [];
      rows.push(...(values as string[][]));
    } catch (error) {
      logger.warn({ error }, 'Google Sheets fetch failed; using fallback rows');
    }
  }

  if (!rows.length && options.fallbackRows) {
    rows.push(...options.fallbackRows);
  }

  if (!rows.length) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const headerMap = header.map((h) => h.toLowerCase());

  return dataRows.map((row, index) => {
    const record: Record<string, string> = {};
    row.forEach((value, idx) => {
      record[headerMap[idx] ?? `col_${idx}`] = value;
    });

    const title = record['title'] ?? `Sheet Product ${index + 1}`;
    const price = parseFloat(record['price'] ?? '10');
    const optionName = record['option1 name'] ?? 'Default';
    const optionValue = record['option1 value'] ?? 'Standard';
    const images = Object.entries(record)
      .filter(([key]) => key.startsWith('image'))
      .map(([, value]) => value)
      .filter(Boolean)
      .map((url) => ({ url }));

    const source: RawSource = {
      type: 'google-sheets',
      identifier: record['handle'] ?? `${index}-${hashContent(JSON.stringify(record)).slice(0, 8)}`,
      payload: record
    };

    return {
      source,
      title,
      description: record['description'],
      vendor: record['vendor'],
      productType: record['product type'] ?? 'General',
      attributes: [
        { name: 'Source', value: 'Google Sheets' },
        { name: optionName, value: optionValue }
      ],
      tags: record['tags'] ? record['tags'].split(',').map((tag) => tag.trim()) : [],
      options: [{ name: optionName, values: [optionValue] }],
      variants: [
        {
          title,
          price,
          sku: record['sku'],
          options: [{ name: optionName, value: optionValue }],
          inventoryPolicy: 'CONTINUE'
        }
      ],
      images: images.length ? images : [{ url: 'https://via.placeholder.com/800?text=Sheets+Product' }]
    } satisfies NormalizedProduct;
  });
}
