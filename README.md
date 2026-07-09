# LiteParse Worker

A Bun + Hono worker that receives documents (PDFs, Office files, images) and returns parsed text using [liteparse](https://github.com/run-llama/liteparse).

## Features

- 🚀 Fast document parsing with liteparse
- 📄 Supports PDFs, Word (.docx), Excel (.xlsx), and images (PNG, JPG)
- 🔄 Auto-converts Office files and images to PDF before parsing
- 🔍 OCR enabled for scanned documents and images
-  Built with Bun and Hono
- ✅ Pure JavaScript - works in serverless environments
- 🌐 CORS enabled
- 📝 Clean JSON responses

## Installation

```bash
bun install
```

## Usage

### Development

```bash
bun run dev
```

### Production

```bash
bun run start
```

The server will start on `http://localhost:3003` (or the port specified in `PORT` environment variable).

## Deployment to Cloudflare Workers

This worker is fully compatible with Cloudflare Workers using pure JavaScript libraries (no system dependencies required).

### Prerequisites

1. Install Wrangler CLI globally (optional):
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
npx wrangler login
```

### Deploy

```bash
# Deploy to Cloudflare Workers
bun run cf:deploy

# Or using npm/npx
npx wrangler deploy --minify
```

### Local Development with Cloudflare

Test your worker locally with Cloudflare's environment:

```bash
bun run cf:dev
```

This will start a local server that mimics the Cloudflare Workers environment.

### Configuration

Edit `wrangler.toml` to customize:
- Worker name
- Custom domains/routes
- Environment variables

After deployment, your worker will be available at:
`https://liteparse-worker.<your-subdomain>.workers.dev`

## API Endpoints

### GET /

Health check endpoint that returns available endpoints.

**Response:**
```json
{
  "message": "Document Parser Worker",
  "endpoints": {
    "POST /parse": "Upload a PDF file to parse its text content",
    "POST /parse-document": "Upload Office files (Word, Excel, PowerPoint) or images (PNG, JPG, etc.) to parse their text content"
  }
}
```

### POST /parse

Upload a PDF file to extract its text content.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `file` (required) — the PDF to parse
  - Optional parsing hints (all sent as plain multipart string fields, coerced server-side):
    - `needsOcr` (`"true"` / `"false"`) — enable/disable OCR. Default: `true`.
    - `language` — ISO-639-1 code (`"en"`, `"es"`). Mapped internally to Tesseract's ISO-639-3 codes for OCR. Unknown/unmapped codes fall back to `"eng"`.
    - `complexity` (`"low"` / `"medium"` / `"high"`) — `"high"` renders pages at 300 DPI instead of the default 150, for denser/harder documents.
    - `hasForms` (`"true"` / `"false"`) — when `true`, preserves very small text (e.g. fine print in forms) that would otherwise be filtered out.

**Example with curl:**
```bash
curl -X POST http://localhost:3003/parse \
  -F "file=@/path/to/your/document.pdf"
```

**Example with hints:**
```bash
curl -X POST http://localhost:3003/parse \
  -F "file=@/path/to/your/document.pdf" \
  -F "needsOcr=false" \
  -F "language=es" \
  -F "complexity=high" \
  -F "hasForms=true"
```

**Example extracting just the page texts (requires `jq`):**
```bash
curl -s -X POST http://localhost:3003/parse \
  -F "file=@/path/to/your/document.pdf" \
  | jq -r '.pages[]'
```

**Success Response:**
```json
{
  "success": true,
  "filename": "document.pdf",
  "size": 12345,
  "text": "Extracted text content...",
  "pages": ["Page 1 text...", "Page 2 text..."],
  "pageCount": 2,
  "metadata": { "pageCount": 2, "charCount": 3456 },
  "appliedConfig": { "ocrEnabled": true, "ocrLanguage": "eng", "dpi": 150, "preserveVerySmallText": false }
}
```

- `pages` — array of strings, one entry per real page (in order).
- `pageCount` — number of pages parsed.
- `appliedConfig` — the actual `liteparse` config used for this request, reflecting whichever hints were sent (or the defaults, if none were).

**Error Response:**
```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

### POST /parse-document

Upload Office files or images to extract their text content. Files are automatically converted to PDF using pure JavaScript libraries, then parsed with liteparse.

**Supported Formats:**
- **Word**: `.docx` (converted with mammoth + jsPDF)
- **Excel**: `.xlsx` (converted with xlsx + jsPDF)
- **Images**: `.png`, `.jpg`, `.jpeg` (converted with pdf-lib)

**Not Yet Supported:**
- PowerPoint files (`.ppt`, `.pptx`)
- Legacy Office formats (`.doc`, `.xls`)
- Other image formats (`.gif`, `.webp`, `.bmp`, `.tiff`)

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `file` (required) — the document to parse
  - Same optional hints as `/parse` (`needsOcr`, `language`, `complexity`, `hasForms`) — see above

**Example with curl (Word document):**
```bash
curl -X POST http://localhost:3003/parse-document \
  -F "file=@/path/to/your/document.docx"
```

**Example with curl (Image):**
```bash
curl -X POST http://localhost:3003/parse-document \
  -F "file=@/path/to/your/image.png"
```

**Example with curl (Excel):**
```bash
curl -X POST http://localhost:3003/parse-document \
  -F "file=@/path/to/your/spreadsheet.xlsx"
```

**Example with hints (image, forced OCR in Spanish):**
```bash
curl -X POST http://localhost:3003/parse-document \
  -F "file=@/path/to/your/scanned-form.png" \
  -F "needsOcr=true" \
  -F "language=es" \
  -F "hasForms=true"
```

**Success Response:**
```json
{
  "success": true,
  "filename": "document.docx",
  "size": 45678,
  "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "convertedToPdf": true,
  "text": "Extracted text content...",
  "pages": ["Page 1 text...", "Page 2 text..."],
  "pageCount": 2,
  "metadata": { "pageCount": 2, "charCount": 3456 },
  "appliedConfig": { "ocrEnabled": true, "ocrLanguage": "eng", "dpi": 150, "preserveVerySmallText": false }
}
```

The `convertedToPdf` field indicates whether the file was converted to PDF before parsing. `pages`, `pageCount`, and `appliedConfig` behave the same as in `/parse` above.

**Error Response (Unsupported Format):**
```json
{
  "error": "PowerPoint conversion is not yet supported. Please convert to PDF manually or use Word/Excel/Images.",
  "receivedType": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
}
```

**Error Response (Invalid Type):**
```json
{
  "error": "Invalid file type. Supported formats: Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.ppt, .pptx), Images (.png, .jpg, .jpeg, .gif, .webp, .bmp, .tiff)",
  "receivedType": "application/zip"
}
```

## Environment Variables

- `PORT` - Server port (default: 3003)

## Technologies

- [Bun](https://bun.sh/) - Fast JavaScript runtime
- [Hono](https://hono.dev/) - Lightweight web framework
- [liteparse](https://github.com/run-llama/liteparse) - Document parsing library with OCR support
- [pdf-lib](https://pdf-lib.js.org/) - Pure JavaScript PDF creation (for image conversion)
- [xlsx](https://sheetjs.com/) - Excel file parsing
- [jsPDF](https://github.com/parallax/jsPDF) - PDF generation (for Excel/Word conversion)
- [mammoth](https://github.com/mwilliamson/mammoth.js) - Word document text extraction

## How It Works

1. **PDF files** → Parsed directly with liteparse
2. **Images (PNG, JPG)** → Converted to PDF with pdf-lib → Parsed with liteparse
3. **Excel (.xlsx)** → Converted to PDF with xlsx + jsPDF → Parsed with liteparse
4. **Word (.docx)** → Converted to PDF with mammoth + jsPDF → Parsed with liteparse

All conversions use pure JavaScript libraries, making this worker compatible with serverless environments like Cloudflare Workers (no system dependencies required).
