import type { ParsedPage, TextItem } from '@llamaindex/liteparse';

export interface MarkdownOptions {
  enableMarkdownHeadings?: boolean;
}

interface Line {
  text: string;
  fontSize: number;
}

const HEADING_SIZE_RATIO = 1.15;
const HEADING_MAX_WORDS = 15;
const MAX_HEADING_LEVELS = 3;
const BULLET_RE = /^[•\-*]\s+/;
const NUMBERED_RE = /^(\d+)[.)]\s+(.*)$/;

function dominantFontSize(items: TextItem[]): number {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (typeof item.fontSize !== 'number' || item.fontSize <= 0) continue;
    counts.set(item.fontSize, (counts.get(item.fontSize) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

// Groups textItems into visual lines by y-proximity (tolerance scaled to item height),
// since liteparse gives per-item positions but not pre-grouped lines.
function groupIntoLines(items: TextItem[]): Line[] {
  const real = items.filter((it) => !it.isPlaceholder && !it.vgap && it.str.trim().length > 0);
  const sorted = [...real].sort((a, b) => a.y - b.y || a.x - b.x);

  const clusters: TextItem[][] = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const lastAvgY = last.reduce((sum, i) => sum + i.y, 0) / last.length;
      const tolerance = Math.max(2, (item.height || item.h || 10) * 0.5);
      if (Math.abs(item.y - lastAvgY) <= tolerance) {
        last.push(item);
        continue;
      }
    }
    clusters.push([item]);
  }

  return clusters
    .map((clusterItems) => {
      const ordered = [...clusterItems].sort((a, b) => a.x - b.x);
      const text = ordered.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      return { text, fontSize: dominantFontSize(ordered) };
    })
    .filter((line) => line.text.length > 0);
}

function computeBodySize(pages: ParsedPage[]): number {
  const textItems = pages.flatMap((p) => p.textItems).filter((it) => it.fontName !== 'OCR' && it.str.trim().length > 0);
  return dominantFontSize(textItems);
}

// Bucket distinct larger-than-body sizes document-wide (not per page) into up to 3 levels,
// so heading levels stay consistent across the whole document instead of resetting per page.
function computeHeadingLevels(pages: ParsedPage[], bodySize: number): number[] {
  if (bodySize <= 0) return [];
  const sizes = new Set<number>();
  for (const page of pages) {
    for (const item of page.textItems) {
      if (item.fontName === 'OCR') continue;
      if (typeof item.fontSize === 'number' && item.fontSize >= bodySize * HEADING_SIZE_RATIO) {
        sizes.add(item.fontSize);
      }
    }
  }
  return [...sizes].sort((a, b) => b - a).slice(0, MAX_HEADING_LEVELS);
}

function isHeadingCandidate(line: Line, bodySize: number): boolean {
  if (bodySize <= 0 || line.fontSize < bodySize * HEADING_SIZE_RATIO) return false;
  const wordCount = line.text.split(/\s+/).filter(Boolean).length;
  return wordCount > 0 && wordCount <= HEADING_MAX_WORDS;
}

function normalizeList(text: string): string {
  if (BULLET_RE.test(text)) return text.replace(BULLET_RE, '- ');
  const numbered = text.match(NUMBERED_RE);
  if (numbered) return `${numbered[1]}. ${numbered[2]}`;
  return text;
}

export function reconstructMarkdownPages(pages: ParsedPage[], options: MarkdownOptions = {}): string[] {
  const enabled = options.enableMarkdownHeadings ?? true;
  if (!enabled) return pages.map((p) => p.text);

  const bodySize = computeBodySize(pages);
  const headingLevels = computeHeadingLevels(pages, bodySize);

  return pages.map((page) => {
    const lines = groupIntoLines(page.textItems);
    if (lines.length === 0) return page.text;

    return lines
      .map((line) => {
        if (isHeadingCandidate(line, bodySize)) {
          const level = headingLevels.indexOf(line.fontSize);
          if (level !== -1) return `${'#'.repeat(level + 1)} ${line.text}`;
        }
        return normalizeList(line.text);
      })
      .join('\n');
  });
}
