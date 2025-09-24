export type SourceType = 'aliexpress' | 'csv' | 'google-sheets' | 'dsers-winning';

export interface RawSource {
  type: SourceType;
  identifier: string;
  payload: unknown;
}

export interface NormalizedVariant {
  title: string;
  sku?: string;
  price: number;
  options: { name: string; value: string }[];
  inventoryPolicy?: 'DENY' | 'CONTINUE';
}

export interface NormalizedProduct {
  source: RawSource;
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
  attributes: { name: string; value: string }[];
  tags?: string[];
  options: { name: string; values: string[] }[];
  variants: NormalizedVariant[];
  images: { url: string; alt?: string }[];
}
