import { parse } from 'csv-parse/sync';
import { hashContent } from '../utils/crypto.js';
import type { NormalizedProduct, RawSource } from './types.js';

interface CsvImportOptions {
  content: string;
}

export function importFromCsv(options: CsvImportOptions): NormalizedProduct[] {
  const rows = parse(options.content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  return rows.map((row, index) => {
    const identifier = row['Handle'] ?? `${index}-${hashContent(JSON.stringify(row)).slice(0, 8)}`;
    const title = row['Title'] ?? `CSV Product ${index + 1}`;
    const price = parseFloat(row['Price'] ?? '10');
    const optionName = row['Option1 Name'] ?? 'Default';
    const optionValue = row['Option1 Value'] ?? 'Standard';
    const images = Object.entries(row)
      .filter(([key]) => key.startsWith('Image'))
      .map(([, value]) => value)
      .filter(Boolean)
      .map((url) => ({ url }));

    const source: RawSource = {
      type: 'csv',
      identifier,
      payload: row
    };

    return {
      source,
      title,
      description: row['Body (HTML)'] ?? row['Description'],
      vendor: row['Vendor'],
      productType: row['Type'] ?? row['Product Type'] ?? 'General',
      attributes: [
        { name: 'Source', value: 'CSV' },
        { name: optionName, value: optionValue }
      ],
      tags: row['Tags'] ? row['Tags'].split(',').map((tag) => tag.trim()) : [],
      options: [{ name: optionName, values: [optionValue] }],
      variants: [
        {
          title,
          price,
          sku: row['Variant SKU'],
          options: [{ name: optionName, value: optionValue }],
          inventoryPolicy: row['Inventory Policy'] === 'deny' ? 'DENY' : 'CONTINUE'
        }
      ],
      images: images.length ? images : [{ url: 'https://via.placeholder.com/800?text=CSV+Product' }]
    } satisfies NormalizedProduct;
  });
}
