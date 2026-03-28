FROM oven/bun:1.2-alpine

# Install system dependencies required by liteparse
RUN apk add --no-cache \
    imagemagick \
    libreoffice \
    tesseract-ocr \
    tesseract-ocr-data-spa \
    tesseract-ocr-data-eng \
    poppler-utils \
    ghostscript

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Expose port
EXPOSE 3003

# Set environment variables
ENV PORT=3003
ENV NODE_ENV=production

# Start the application
CMD ["bun", "run", "start"]
