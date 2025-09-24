import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'not implemented' }));
});

describe('seo content generation', () => {
  it('builds fallback content when OpenAI is unavailable', async () => {
    const { generateContent } = await import('../src/rules/seo.js');
    const content = await generateContent({
      title: 'Test Product',
      attributes: [
        { name: 'Material', value: 'Cotton' },
        { name: 'Color', value: 'Blue' }
      ],
      benefits: ['Soft fabric', 'Easy care']
    });
    expect(content.descriptionHtml).toContain('Test Product');
    expect(content.altTexts).toHaveLength(2);
    expect(content.seoTitle).toContain('Test Product');
  });
});
