# liteparse-worker: real per-page markdown + pluggable parsing strategies

## Context

`simon-mvp`'s ingestion pipeline calls an external parser at `PARSER_URL` (`http://parse.apastar.me/parse`) during the `parse` stage (`workers/stages/parse.ts`). That service is **`liteparse-worker`** — a Bun + Hono wrapper around the `@llamaindex/liteparse` npm package (v1.4.0), deployed via Docker on the shared `apastar` network. It is **not** Python; the earlier assumption ("liteparser" in Python) was a mix-up, confirmed and accepted — this plan targets the real TypeScript service in place.

Two concrete problems were found by reading the actual code and the `@llamaindex/liteparse` type definitions:

1. **Every document collapses to a single page**, regardless of real page count. A 156-page PDF ingested today produced exactly **1** `document_pages` row in `simon-mvp` — this was flagged as an open risk ("R1") in the ingestion-pipeline plan and is now confirmed root-caused: `liteparse-worker/src/index.ts` only returns `result.text` (the whole-document concatenation) and **completely discards `result.pages`**, even though `LiteParse.parse()` already returns `ParseResult.pages: ParsedPage[]` with real per-page `text` — the fix is almost trivial, the library already does the work.
2. **No markdown structure is ever produced.** `liteparse`'s text output is spatial plain text (layout-preserving, not semantic). `simon-mvp`'s chunking (`lib/pipeline/chunking.ts`) splits on markdown headings (`^#{1,6}`); with zero real headings in the source, every chunk from every real document has fallen into a single generic "Introducción" section — chunk/section quality has been silently degraded pipeline-wide since Phase 4 shipped.

There's also a **latent bug**: `src/index.ts` returns `metadata: result.metadata || {}` but `ParseResult` (per `@llamaindex/liteparse`'s own `.d.ts`) has no `metadata` field at all — that field has always silently been `{}`.

Separately, `simon-mvp`'s Document Profile stage (`workers/stages/profile.ts`) already computes `needsOcr`, `hasTables`, `hasImages`, `hasForms`, `complexity`, `language` per document via an LLM classifier — but the parse stage never sends any of it to the parser. `liteparse`'s `LiteParseConfig` already exposes the exact knobs needed (`ocrEnabled`, `ocrLanguage`, `dpi`, `preserveVerySmallText`) to act on those fields; they're just unwired.

**Goal:** fix page-splitting and metadata correctness first (near-zero risk, unblocks large documents immediately), wire the Document Profile's fields into `liteparse`'s config as pluggable strategies, then reconstruct real markdown structure (headings, lists) from the font/position data `liteparse` already returns — closing the chunking-quality gap at the root.

## Target repo

`liteparse-worker` (`git@github.com:marceloag/liteparse-worker.git`). This plan file will be copied into that repo's own `./plans` (or root) once approved — all paths below are relative to that repo's root, not `simon-mvp`.

Key files today:

- `src/index.ts` (159 lines) — Hono app, `GET /`, `POST /parse` (PDF-only), `POST /parse-document` (Office/image → PDF via `converters.ts`, then same `LiteParse` call).
- `src/converters.ts` — image/Excel/Word → PDF conversion helpers (`pdf-lib`, `xlsx`+`jspdf-autotable`, `mammoth`+`jsPDF`).
- `Dockerfile` — `oven/bun:1.2-alpine` + `imagemagick`, `libreoffice`, `tesseract-ocr` (`eng`, `spa` lang packs), `poppler-utils`, `ghostscript`.
- `docker-compose.yml` — joins external `apastar` network (same one `simon-mvp` joins), port 3003.

`@llamaindex/liteparse` (v1.4.0) already provides everything needed, confirmed from its shipped `.d.ts`:

- `ParseResult { pages: ParsedPage[]; text: string; json?: ParseResultJson }` — `pages[i].text` is **always** populated (not gated behind `outputFormat`).
- `ParsedPage { pageNum, width, height, text, textItems: TextItem[] }` — `textItems` carry `x, y, width, height, fontName, fontSize, confidence` per text run, always present.
- `LiteParseConfig`: `ocrEnabled`, `ocrLanguage` (ISO-639-3, e.g. `"eng"`, `"spa"`), `dpi`, `preciseBoundingBox`, `preserveVerySmallText`, `maxPages`, `targetPages`, `password`.

## Phase 1 — Real per-page output + fix the metadata bug

**Files:** `src/index.ts` (both `/parse` and `/parse-document` handlers).

1. After `const result = await parser.parse(buffer)`, add to the JSON response:
   - `pages: result.pages.map((p) => p.text)` — a plain `string[]`, one entry per real PDF page.
   - `pageCount: result.pages.length`.
2. Remove the fake `metadata: result.metadata || {}` (the field doesn't exist on `ParseResult`). Replace with real, cheap-to-compute stats: `{ pageCount: result.pages.length, charCount: result.text.length }`. Keep the key name `metadata` for backward compatibility with any caller reading it, just make its contents real.
3. No changes needed on the `simon-mvp` side — its consumer (`workers/stages/parse.ts`) already prefers `res.pages: string[]` first, before falling back to form-feed splitting or a single blob. This alone fixes the 156-page collapse.

**Verify:** `bun run dev`, `curl -F file=@<multi-page.pdf> http://localhost:3003/parse | jq '.pageCount, (.pages | length)'` — both numbers must equal the PDF's real page count (cross-check with `pdfinfo <file>.pdf | grep Pages` or any PDF viewer). Confirm `.pages[0]` and `.pages[1]` contain genuinely different page content, not duplicates or the whole-doc blob repeated.

## Phase 2 — Wire Document Profile fields into `LiteParseConfig`

**Files:** `src/index.ts`, new `src/strategy.ts`.

1. `src/strategy.ts`: a small zod schema (add `zod` as an explicit dependency — already a transitive dep of `liteparse` but not declared directly) parsing optional multipart string fields into a typed hint object:
   ```ts
   { needsOcr?: boolean; language?: string; complexity?: 'low'|'medium'|'high'; hasForms?: boolean }
   ```
   (multipart fields arrive as strings — `"true"`/`"false"` — coerce explicitly.)
2. A `mapHintsToConfig(hints)` function → `Partial<LiteParseConfig>`:
   - `ocrEnabled = hints.needsOcr ?? true` (default `true` preserves current behavior for callers that send nothing).
   - `ocrLanguage`: map the Document Profile's ISO-639-1 code (`"en"`, `"es"`) to Tesseract's ISO-639-3 (`"eng"`, `"spa"`) via a small lookup table seeded with the languages already installed in the Dockerfile (`eng`, `spa`); unknown codes fall back to `"eng"`. Note in a comment that adding a language requires both a Dockerfile `tesseract-ocr-data-*` package and an entry in this table.
   - `dpi = hints.complexity === 'high' ? 300 : 150`.
   - `preserveVerySmallText = hints.hasForms === true` (fine print in forms).
   - Leave `preciseBoundingBox` at its default (`true`) — needed by Phase 4.
3. In both route handlers: parse hints from `body`, compute config, `new LiteParse(mapHintsToConfig(hints))`, and echo `appliedConfig` in the response for debuggability (mirrors the debug-first pattern already used throughout `simon-mvp`'s own pipeline UI).

**Companion change needed in `simon-mvp` (not part of this repo, note only):** `workers/stages/parse.ts` currently POSTs only the `file` field. To actually exercise Phase 2, it should also append `doc.profile.needsOcr`, `doc.profile.language`, `doc.profile.complexity`, `doc.profile.hasForms` (already stored as JSON on the `documents` row from the profile stage) as extra multipart fields before calling `PARSER_URL`. Flag this to whoever picks up the `simon-mvp` side; it's a ~5-line change at the `formData.append('file', ...)` call site.

**Verify:** parse the same PDF twice — once with `needsOcr=false` (confirm it returns noticeably faster and confirm via a log line that OCR was skipped) and once with `needsOcr=true` — both must succeed with no crash, and `appliedConfig` in the response must reflect the actual difference.

## Phase 3 — Markdown structure reconstruction (headings, lists)

**Files:** new `src/markdown.ts`, wired into `src/index.ts` to replace the plain-text content of the `pages` array from Phase 1.

Root problem restated: `result.text`/`result.pages[i].text` is spatial plain text with zero markdown syntax, so `simon-mvp`'s heading-based chunker never finds a real section boundary. `liteparse` doesn't produce markdown itself, but it gives us the ingredients (`TextItem.fontSize`, `x`, `y`, `fontName`) to reconstruct it heuristically:

1. **Global font-size baseline**: across all pages' `textItems` (excluding items where `fontName === "OCR"`, since OCR text has unreliable font metadata), compute the mode/median font size → "body text" size.
2. **Heading detection**: group `textItems` per page into lines by `y`-proximity. A line is a heading candidate if its dominant font size is ≥ ~1.15× the body size AND it's short (a rough word-count cap, e.g. < 15 words) AND isolated on its own line. Bucket the distinct larger-than-body sizes found **document-wide** (not per page) into up to 3 levels, largest → `#`, next → `##`, next → `###`, so heading levels stay consistent across the whole document rather than resetting per page.
3. **List detection**: lines whose text starts with `•`, `-`, `*`, or a numbered pattern (`\d+\.`) get normalized to markdown list syntax if not already present.
4. Everything else in a line falls back to the existing plain text.
5. Feature-flag this behind `enableMarkdownHeadings` (default `true`, overridable via a hint field) so it can be disabled instantly if it misbehaves on a production document class without a code rollback.
6. This function replaces the content of the `pages: string[]` array from Phase 1 — no new response field, so `simon-mvp` benefits automatically with zero further changes (it already just consumes `res.pages`).

**Verify:** run against a document with visually obvious section titles (larger, bold, isolated lines) and confirm `#`/`##` markers land in the right places in the output; run against a dense table-heavy financial report and confirm table header rows are _not_ misdetected as markdown headings (tune the word-count/isolation thresholds if they are); re-run the 156-page sustainability report from Phase 1 and spot-check 3-4 pages by eye. Cross-check in `simon-mvp` itself: after redeploying, re-ingest a document and confirm `document_chunks.section` values are no longer uniformly "Introducción" — real section names should appear.

## Phase 4 (stretch, optional) — Table reconstruction as markdown pipe tables

Not required for this round; call out as a follow-up only. `liteparse` has no native table-structure detector (unlike Docling's `do_table_structure`), so this means clustering `textItems` into a grid via repeated shared `x`-start columns across ≥3 consecutive rows and emitting a markdown pipe table only when a confident grid is found, otherwise leaving the plain text untouched. Recommend shipping Phases 1–3 first, evaluating real chunk quality on `simon-mvp` with actual production documents, and only building this if flattened table text turns out to hurt retrieval/enrichment quality in practice.

## Deployment / end-to-end verification

1. Local dev loop: `bun install`, `bun run dev` (hot reload, port 3003), `curl -F file=@sample.pdf http://localhost:3003/parse | jq`.
2. Production redeploy (per repo's own `DOCKER_DEPLOYMENT.md`): `docker compose build && docker compose up -d` on the VPS, same `apastar` network `simon-mvp` joins — `parse.apastar.me` should reflect changes immediately after.
3. Full loop check against `simon-mvp`: after redeploying, upload a real multi-page PDF through `/pipelines`, watch it reach `parsed`, and confirm in Postgres that `document_pages` row count now matches the PDF's real page count (was always `1` before this fix) — e.g. `select count(*) from document_pages where document_id = '<id>'`. After Phase 3 lands, also confirm `document_chunks.section` shows real, varied section names instead of a single fallback value.

## Critical files

| Concern                                             | File                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Response shape / metadata bug                       | `src/index.ts`                                                                        |
| Strategy hints → LiteParseConfig                    | `src/strategy.ts` (new)                                                               |
| Markdown reconstruction                             | `src/markdown.ts` (new)                                                               |
| Language code mapping                               | `src/strategy.ts` (new, alongside hints)                                              |
| Deploy                                              | `Dockerfile`, `docker-compose.yml` (no changes expected, referenced for verification) |
| `@llamaindex/liteparse` types (read-only reference) | `node_modules/@llamaindex/liteparse/dist/src/core/types.d.ts`                         |
| Companion change (separate repo, note only)         | `simon-mvp/workers/stages/parse.ts`                                                   |
