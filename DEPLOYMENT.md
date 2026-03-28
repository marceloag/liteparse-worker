# Deployment Guide to Cloudflare Workers

## Quick Start

### 1. Login to Cloudflare
```bash
npx wrangler login
```
This will open your browser to authenticate with Cloudflare.

### 2. Deploy to Cloudflare Workers
```bash
bun run cf:deploy
```

Or using npm:
```bash
npx wrangler deploy --minify
```

### 3. Your worker will be live at:
```
https://liteparse-worker.<your-subdomain>.workers.dev
```

## Test Your Deployment

Once deployed, test with:

```bash
# Test health endpoint
curl https://liteparse-worker.<your-subdomain>.workers.dev/

# Test PDF parsing
curl -X POST https://liteparse-worker.<your-subdomain>.workers.dev/parse \
  -F "file=@document.pdf"

# Test document parsing (Excel, Word, Images)
curl -X POST https://liteparse-worker.<your-subdomain>.workers.dev/parse-document \
  -F "file=@spreadsheet.xlsx"
```

## Local Development with Cloudflare Environment

Test locally before deploying:

```bash
bun run cf:dev
```

This starts a local server at `http://localhost:8787` that mimics Cloudflare Workers.

## Configuration

### Custom Domain

Edit `wrangler.toml` to add a custom domain:

```toml
routes = [
  { pattern = "api.yourdomain.com", zone_name = "yourdomain.com" }
]
```

### Environment Variables

Add environment variables in `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
```

Or use secrets for sensitive data:

```bash
npx wrangler secret put API_KEY
```

## Troubleshooting

### Issue: "Not logged in"
Run `npx wrangler login` again.

### Issue: "Worker name already exists"
Change the `name` in `wrangler.toml` to something unique.

### Issue: Large bundle size
The worker uses pure JavaScript libraries, so it should be well under Cloudflare's limits.
Current dependencies are optimized for serverless environments.

## Monitoring

View logs in real-time:

```bash
npx wrangler tail
```

Or view in Cloudflare Dashboard:
1. Go to https://dash.cloudflare.com
2. Select "Workers & Pages"
3. Click on your worker
4. View metrics and logs

## Updating

To update your deployed worker:

```bash
# Make your changes, then redeploy
bun run cf:deploy
```

Changes are live immediately after deployment.
