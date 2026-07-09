import { z } from 'zod';
import type { LiteParseConfig } from '@llamaindex/liteparse';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'string' ? v === 'true' : v))
  .optional();

export const HintsSchema = z.object({
  needsOcr: boolFromString,
  language: z.string().optional(),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  hasForms: boolFromString,
  enableMarkdownHeadings: boolFromString,
});

export type Hints = z.infer<typeof HintsSchema>;

export function parseHints(body: Record<string, unknown>): Hints {
  return HintsSchema.parse({
    needsOcr: body['needsOcr'],
    language: body['language'],
    complexity: body['complexity'],
    hasForms: body['hasForms'],
    enableMarkdownHeadings: body['enableMarkdownHeadings'],
  });
}

// ISO-639-1 (Document Profile) -> ISO-639-3 (Tesseract). Adding a language here
// also requires installing its tesseract-ocr-data-* package in the Dockerfile.
const LANGUAGE_MAP: Record<string, string> = {
  en: 'eng',
  es: 'spa',
};

export function mapLanguage(language: string | undefined): string {
  if (!language) return 'eng';
  return LANGUAGE_MAP[language] ?? 'eng';
}

export function mapHintsToConfig(hints: Hints): Partial<LiteParseConfig> {
  return {
    ocrEnabled: hints.needsOcr ?? true,
    ocrLanguage: mapLanguage(hints.language),
    dpi: hints.complexity === 'high' ? 300 : 150,
    preserveVerySmallText: hints.hasForms === true,
  };
}
