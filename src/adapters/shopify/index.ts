import { env } from '../../utils/env.js';
import { logger } from '../../utils/logger.js';
import { hashContent } from '../../utils/crypto.js';

const COLLECTIONS = ['Lifestyle', 'Home Goods', 'Beauty & Care', 'Outdoors', 'All Products'];

export interface ShopifyProductInput {
  title: string;
  bodyHtml: string;
  vendor?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'DRAFT';
  productType?: string;
  seo?: {
    title?: string;
    description?: string;
  };
  options?: { name: string; values: string[] }[];
  variants: ShopifyVariantInput[];
  media?: ShopifyMediaInput[];
  metafields?: ShopifyMetafieldInput[];
}

export interface ShopifyVariantInput {
  title?: string;
  sku?: string;
  price: string;
  compareAtPrice?: string;
  inventoryPolicy?: 'DENY' | 'CONTINUE';
  requiresShipping?: boolean;
  weight?: number;
  weightUnit?: 'GRAMS' | 'KILOGRAMS' | 'POUNDS' | 'OUNCES';
  barcode?: string;
  options: string[];
}

export interface ShopifyMediaInput {
  originalSource: string;
  alt?: string;
  mediaContentType?: 'IMAGE' | 'VIDEO' | 'MODEL_3D';
}

export interface ShopifyMetafieldInput {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export interface ShopifyProductResult {
  productId: string;
  variantIds: string[];
}

interface GraphQLError {
  message: string;
  extensions?: Record<string, unknown>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

class ShopifyGraphQLClient {
  private readonly endpoint: string;
  constructor() {
    this.endpoint = `https://${env.SHOPIFY_STORE}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;
  }

  async request<T>(query: string, variables?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        'Idempotency-Key': idempotencyKey ?? hashContent(JSON.stringify({ query, variables }))
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Shopify request failed: ${response.status} ${body}`);
    }

    const json = (await response.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    if (!json.data) {
      throw new Error('Shopify GraphQL returned empty data');
    }
    return json.data;
  }
}

const client = new ShopifyGraphQLClient();

function toMoney(value: number | string): string {
  return typeof value === 'number' ? value.toFixed(2) : value;
}

export async function createProduct(input: ShopifyProductInput): Promise<ShopifyProductResult> {
  const mutation = /* GraphQL */ `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          handle
          variants(first: 50) {
            nodes { id }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const payload = {
    input: {
      title: input.title,
      bodyHtml: input.bodyHtml,
      productType: input.productType ?? 'General',
      status: input.status ?? 'ACTIVE',
      tags: input.tags ?? [],
      options: input.options,
      seo: input.seo,
      media: input.media?.map((m) => ({
        mediaContentType: m.mediaContentType ?? 'IMAGE',
        originalSource: m.originalSource,
        alt: m.alt ?? undefined
      })),
      variants: input.variants.map((variant) => ({
        title: variant.title ?? input.title,
        price: toMoney(variant.price),
        compareAtPrice: variant.compareAtPrice ? toMoney(variant.compareAtPrice) : undefined,
        sku: variant.sku,
        inventoryPolicy: variant.inventoryPolicy ?? 'DENY',
        requiresShipping: variant.requiresShipping ?? true,
        weight: variant.weight,
        weightUnit: variant.weightUnit ?? 'GRAMS',
        barcode: variant.barcode,
        options: variant.options
      })),
      metafields: input.metafields?.map((m) => ({
        namespace: m.namespace,
        key: m.key,
        value: m.value,
        type: m.type
      }))
    }
  };

  const data = await client.request<{
    productCreate: {
      product: { id: string; variants: { nodes: { id: string }[] } } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(mutation, payload);

  const result = data.productCreate;
  if (result.userErrors.length) {
    throw new Error(`Shopify productCreate errors: ${JSON.stringify(result.userErrors)}`);
  }
  if (!result.product) {
    throw new Error('Shopify did not return a product');
  }
  const variantIds = result.product.variants.nodes.map((node) => node.id);
  return { productId: result.product.id, variantIds };
}

export async function bulkCreateVariants(productId: string, variants: ShopifyVariantInput[]): Promise<string[]> {
  if (!variants.length) {
    return [];
  }
  const mutation = /* GraphQL */ `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `;

  const data = await client.request<{
    productVariantsBulkCreate: {
      productVariants: { id: string }[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(mutation, {
    productId,
    variants: variants.map((variant) => ({
      price: toMoney(variant.price),
      compareAtPrice: variant.compareAtPrice ? toMoney(variant.compareAtPrice) : undefined,
      options: variant.options,
      sku: variant.sku,
      inventoryPolicy: variant.inventoryPolicy ?? 'DENY',
      requiresShipping: variant.requiresShipping ?? true
    }))
  });

  const result = data.productVariantsBulkCreate;
  if (result.userErrors.length) {
    throw new Error(`Shopify productVariantsBulkCreate errors: ${JSON.stringify(result.userErrors)}`);
  }
  return result.productVariants.map((variant) => variant.id);
}

export async function fileCreate(files: ShopifyMediaInput[]): Promise<void> {
  if (!files.length) {
    return;
  }
  const mutation = /* GraphQL */ `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id }
        userErrors { field message }
      }
    }
  `;
  const result = await client.request<{
    fileCreate: {
      userErrors: { field: string[]; message: string }[];
    };
  }>(mutation, {
    files: files.map((file) => ({
      alt: file.alt,
      contentType: file.mediaContentType ?? 'IMAGE',
      originalSource: file.originalSource
    }))
  });

  if (result.fileCreate.userErrors.length) {
    throw new Error(`Shopify fileCreate errors: ${JSON.stringify(result.fileCreate.userErrors)}`);
  }
}

export async function metafieldsSet(productId: string, metafields: ShopifyMetafieldInput[]): Promise<void> {
  if (!metafields.length) {
    return;
  }
  const mutation = /* GraphQL */ `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }
  `;
  const result = await client.request<{
    metafieldsSet: {
      userErrors: { field: string[]; message: string }[];
    };
  }>(mutation, {
    metafields: metafields.map((field) => ({
      ownerId: productId,
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      value: field.value
    }))
  });

  if (result.metafieldsSet.userErrors.length) {
    throw new Error(`Shopify metafieldsSet errors: ${JSON.stringify(result.metafieldsSet.userErrors)}`);
  }
}

function toHandle(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export interface CollectionRecord {
  id: string;
  title: string;
}

export async function ensureCollections(): Promise<Record<string, CollectionRecord>> {
  const result: Record<string, CollectionRecord> = {};
  for (const title of COLLECTIONS) {
    const handle = toHandle(title);
    const query = /* GraphQL */ `
      query collectionByHandle($handle: String!) {
        collectionByHandle(handle: $handle) { id title handle }
      }
    `;
    const data = await client.request<{
      collectionByHandle: { id: string; title: string } | null;
    }>(query, { handle });

    if (data.collectionByHandle) {
      result[title] = { id: data.collectionByHandle.id, title: data.collectionByHandle.title };
      continue;
    }

    const mutation = /* GraphQL */ `
      mutation collectionCreate($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title }
          userErrors { field message }
        }
      }
    `;
    const created = await client.request<{
      collectionCreate: {
        collection: { id: string; title: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(mutation, {
      input: {
        title,
        handle,
        descriptionHtml: `${title} curated by adealtd.com`
      }
    });
    if (created.collectionCreate.userErrors.length) {
      throw new Error(`collectionCreate errors: ${JSON.stringify(created.collectionCreate.userErrors)}`);
    }
    if (!created.collectionCreate.collection) {
      throw new Error('Failed to create collection');
    }
    result[title] = {
      id: created.collectionCreate.collection.id,
      title: created.collectionCreate.collection.title
    };
  }
  return result;
}

export async function assignCollections(productId: string, collectionIds: string[]): Promise<void> {
  if (!collectionIds.length) {
    return;
  }
  const mutation = /* GraphQL */ `
    mutation collectionAddProducts($collectionId: ID!, $productIds: [ID!]!) {
      collectionAddProductsV2(collectionId: $collectionId, productIds: $productIds) {
        userErrors { field message }
      }
    }
  `;
  for (const id of collectionIds) {
    const result = await client.request<{
      collectionAddProductsV2: {
        userErrors: { field: string[]; message: string }[];
      };
    }>(mutation, {
      collectionId: id,
      productIds: [productId]
    });
    if (result.collectionAddProductsV2.userErrors.length) {
      throw new Error(`collectionAddProductsV2 errors: ${JSON.stringify(result.collectionAddProductsV2.userErrors)}`);
    }
  }
}

export async function publishProduct(productId: string): Promise<void> {
  const mutation = /* GraphQL */ `
    mutation publishablePublish($id: ID!) {
      publishablePublish(id: $id, input: { publicationIds: ["gid://shopify/Publication/online-store"] }) {
        userErrors { field message }
      }
    }
  `;
  try {
    await client.request(mutation, { id: productId });
  } catch (error) {
    logger.warn({ error, productId }, 'Publish product failed but continuing');
  }
}

export function collectionNames(): string[] {
  return [...COLLECTIONS];
}
