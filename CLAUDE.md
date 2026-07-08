# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bun + Hono HTTP worker. Takes uploaded documents (PDF, .docx, .xlsx, images), converts non-PDF formats to PDF using pure-JS libraries, then parses text out with `@llamaindex/liteparse` (OCR enabled). Dual-deployable: runs standalone under Bun, or as a Cloudflare Worker via Wrangler.

## Commands

```bash
bun install        # install deps
bun run dev         # local dev, hot reload, port 3003 (or $PORT)
bun run start       # local prod run
bun run cf:dev      # local run under Cloudflare Workers emulation (wrangler dev)
bun run cf:deploy   # deploy to Cloudflare Workers (wrangler deploy --minify)
```

No test suite, lint config, or CI currently exists in this repo.

Docker: `Dockerfile` installs system deps (imagemagick, libreoffice, tesseract-ocr with spa+eng data, poppler-utils, ghostscript) for the Bun-standalone deployment path — these are NOT used/available in the Cloudflare Workers deployment path, which relies solely on the pure-JS converters in `src/converters.ts`.

## Architecture

Two source files, both under `src/`:

- **`index.ts`** — Hono app with two endpoints:
  - `POST /parse` — PDF-only, straight to `LiteParse.parse()`.
  - `POST /parse-document` — accepts Word/Excel/PowerPoint/images, validates MIME type against an allowlist, routes non-PDF types through the matching converter in `converters.ts` before parsing. PowerPoint and image formats other than PNG/JPEG are explicitly rejected (not yet implemented) even though they're in the request-validation allowlist — check both places when adding format support.
  - `export default { port, fetch: app.fetch }` is the dual entry point: Bun uses `port`+`fetch` directly; Wrangler's `main = src/index.ts` (see `wrangler.toml`) uses the same `fetch` export as the Workers handler.

- **`converters.ts`** — pure-JS, no-system-dependency conversion of non-PDF formats to PDF bytes, so the same code runs in Cloudflare Workers (no shell-out to soffice/imagemagick/etc.):
  - `convertImageToPdf` — embeds PNG/JPEG into a new `pdf-lib` page, centered and scaled to fit.
  - `convertExcelToPdf` — reads all sheets via `xlsx`, renders each as a table with `jspdf-autotable` (one page per sheet).
  - `convertWordToPdf` — `mammoth` strips .docx to raw text, then `jsPDF.splitTextToSize` reflows it into a paginated PDF.

  All three converters intentionally discard visual fidelity (layout, images-in-docs, styling) — the goal is only to produce something `liteparse` can OCR/extract text from, not a faithful PDF rendering.

- Everything (`file.type` allowlist, conversion, parsing) happens per-request in memory as `Buffer`s — no persistence, no queue.
