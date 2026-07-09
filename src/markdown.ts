import type { ParsedPage, TextItem } from '@llamaindex/liteparse';

export interface MarkdownOptions {
  enableMarkdownHeadings?: boolean;
  enableTableReconstruction?: boolean;
}

interface Line {
  text: string;
  fontSize: number;
  items: TextItem[];
}

const HEADING_SIZE_RATIO = 1.15;
const HEADING_MAX_WORDS = 15;
const MAX_HEADING_LEVELS = 3;
const BULLET_RE = /^[•\-*]\s+/;
const NUMBERED_RE = /^(\d+)[.)]\s+(.*)$/;

const TABLE_COLUMN_TOLERANCE = 8; // points; column x-starts within this are considered "the same column"
const MIN_TABLE_ROWS = 3;
const MIN_TABLE_COLS = 2;

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
      return { text, fontSize: dominantFontSize(ordered), items: ordered };
    })
    .filter((line) => line.text.length > 0);
}

function rowColumnStarts(items: TextItem[]): number[] {
  return items.map((i) => i.x);
}

function columnsMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, idx) => Math.abs(x - b[idx]) <= TABLE_COLUMN_TOLERANCE);
}

interface TableRun {
  start: number;
  end: number; // inclusive
}

// Finds runs of >=3 consecutive lines whose item x-starts line up into the same
// column pattern — a rough proxy for "this is a table", with no native table
// detector available from liteparse itself.
function detectTableRuns(lines: Line[]): TableRun[] {
  const runs: TableRun[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].items.length < MIN_TABLE_COLS) {
      i++;
      continue;
    }
    const baseColumns = rowColumnStarts(lines[i].items);
    let j = i + 1;
    while (j < lines.length && columnsMatch(rowColumnStarts(lines[j].items), baseColumns)) {
      j++;
    }
    const runLength = j - i;
    if (runLength >= MIN_TABLE_ROWS) {
      runs.push({ start: i, end: j - 1 });
      i = j;
    } else {
      i++;
    }
  }
  return runs;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').trim();
}

function renderTable(lines: Line[], run: TableRun): string {
  const rows = lines.slice(run.start, run.end + 1).map((line) => line.items.map((it) => escapeCell(it.str)));
  const colCount = rows[0].length;
  const header = `| ${rows[0].join(' | ')} |`;
  const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
  const body = rows.slice(1).map((row) => `| ${row.join(' | ')} |`);
  return [header, separator, ...body].join('\n');
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

  const enableTables = options.enableTableReconstruction ?? true;
  const bodySize = computeBodySize(pages);
  const headingLevels = computeHeadingLevels(pages, bodySize);

  return pages.map((page) => {
    const lines = groupIntoLines(page.textItems);
    if (lines.length === 0) return page.text;

    const tableRuns = enableTables ? detectTableRuns(lines) : [];
    const rendered: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const run = tableRuns.find((r) => r.start === i);
      if (run) {
        rendered.push(renderTable(lines, run));
        i = run.end + 1;
        continue;
      }

      const line = lines[i];
      if (isHeadingCandidate(line, bodySize)) {
        const level = headingLevels.indexOf(line.fontSize);
        if (level !== -1) {
          rendered.push(`${'#'.repeat(level + 1)} ${line.text}`);
          i++;
          continue;
        }
      }
      rendered.push(normalizeList(line.text));
      i++;
    }

    return rendered.join('\n');
  });
}
