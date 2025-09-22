import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface ContentInput {
  title: string;
  attributes: ProductAttribute[];
  benefits?: string[];
  tone?: string;
}

export interface GeneratedContent {
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  altTexts: string[];
}

function buildAttributeTable(attributes: ProductAttribute[]): string {
  const rows = attributes
    .map((attr) => `<tr><th style="text-align:left;padding:4px;">${attr.name}</th><td style="padding:4px;">${attr.value}</td></tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

async function callOpenAI(prompt: string): Promise<string | null> {
  if (!env.OPENAI_API_KEY) {
    return null;
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an ecommerce copywriter for Shopify in English.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, body: text }, 'OpenAI request failed');
      return null;
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    logger.error({ error }, 'OpenAI request threw');
    return null;
  }
}

function fallbackDescription(input: ContentInput, tableHtml: string): string {
  const benefits = input.benefits?.length ? `<ul>${input.benefits.map((b) => `<li>${b}</li>`).join('')}</ul>` : '';
  return `<div><p>${input.title} is curated for modern lifestyles. Explore the key highlights below.</p>${benefits}${tableHtml}</div>`;
}

export async function generateContent(input: ContentInput): Promise<GeneratedContent> {
  const table = buildAttributeTable(input.attributes);
  const prompt = `Create an engaging HTML description, SEO title and SEO description for a Shopify product. Title: ${input.title}. Attributes: ${input.attributes
    .map((attr) => `${attr.name}: ${attr.value}`)
    .join(', ')}. Tone: ${input.tone ?? 'Friendly and informative'}.`;

  const gptText = await callOpenAI(prompt);
  let description = fallbackDescription(input, table);
  let seoTitle = `${input.title} | adealtd.com`;
  let seoDescription = `Shop ${input.title} at adealtd.com. Premium selection for Lifestyle, Home Goods, Beauty & Care and Outdoors.`;

  if (gptText) {
    description = `${gptText}\n${table}`;
    const lines = gptText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      seoTitle = lines[0].slice(0, 70);
      seoDescription = lines.slice(1).join(' ').slice(0, 320);
    }
  }

  const altTexts = input.attributes.map((attr) => `${input.title} – ${attr.name}: ${attr.value}`);

  return {
    descriptionHtml: description,
    seoTitle,
    seoDescription,
    altTexts
  };
}
