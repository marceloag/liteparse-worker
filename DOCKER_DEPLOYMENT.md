# Docker Deployment Guide

## Quick Start

### 1. Build and Run with Docker Compose (Recommended)

```bash
docker-compose up -d
```

This will:
- Build the Docker image
- Start the container
- Expose port 3003
- Auto-restart on failure

### 2. Check Status

```bash
docker-compose ps
docker-compose logs -f
```

### 3. Test the Service

```bash
# Health check
curl http://localhost:3003/

# Test PDF parsing
curl -X POST http://localhost:3003/parse \
  -F "file=@document.pdf"

# Test document parsing
curl -X POST http://localhost:3003/parse-document \
  -F "file=@spreadsheet.xlsx"
```

## Manual Docker Commands

### Build Image

```bash
docker build -t liteparse-worker .
```

### Run Container

```bash
docker run -d \
  --name liteparse-worker \
  -p 3003:3003 \
  --restart unless-stopped \
  liteparse-worker
```

### View Logs

```bash
docker logs -f liteparse-worker
```

### Stop Container

```bash
docker stop liteparse-worker
```

### Remove Container

```bash
docker rm liteparse-worker
```

## VPS Deployment

### Prerequisites

1. Docker and Docker Compose installed on your VPS
2. Ports 3003 (or your chosen port) open in firewall

### Deploy to VPS

#### Option 1: Using Git

```bash
# On your VPS
git clone <your-repo-url>
cd liteparse-worker
docker-compose up -d
```

#### Option 2: Using SCP

```bash
# From your local machine
scp -r /Users/marceloag/liteparse-worker user@your-vps-ip:/home/user/

# On your VPS
cd /home/user/liteparse-worker
docker-compose up -d
```

### Configure Reverse Proxy (Optional)

#### Nginx

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Increase timeouts for large file uploads
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
        proxy_read_timeout 600;
        send_timeout 600;
        
        # Increase max body size for file uploads
        client_max_body_size 50M;
    }
}
```

#### Caddy

```caddy
api.yourdomain.com {
    reverse_proxy localhost:3003
}
```

### SSL/HTTPS with Let's Encrypt

#### Using Certbot (Nginx)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

#### Using Caddy (Automatic HTTPS)

Caddy automatically handles SSL certificates. Just use the Caddyfile above.

## Environment Variables

Create a `.env` file:

```env
PORT=3003
NODE_ENV=production
```

Update docker-compose.yml to use it:

```yaml
services:
  liteparse-worker:
    env_file:
      - .env
```

## Monitoring

### View Real-time Logs

```bash
docker-compose logs -f
```

### Check Container Health

```bash
docker-compose ps
docker inspect liteparse-worker --format='{{.State.Health.Status}}'
```

### Resource Usage

```bash
docker stats liteparse-worker
```

## Updating

### Pull Latest Changes and Rebuild

```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Without Downtime (Blue-Green Deployment)

```bash
# Build new image
docker-compose build

# Start new container with different name
docker run -d --name liteparse-worker-new -p 3004:3003 liteparse-worker

# Test new container
curl http://localhost:3004/

# Switch traffic (update nginx/caddy config to point to 3004)
# Then stop old container
docker stop liteparse-worker
docker rm liteparse-worker

# Rename new container
docker rename liteparse-worker-new liteparse-worker
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs

# Check if port is already in use
sudo lsof -i :3003
```

### Out of Memory

Increase memory limits in docker-compose.yml:

```yaml
deploy:
  resources:
    limits:
      memory: 4G
```

### ImageMagick/LibreOffice Issues

The Dockerfile includes all necessary dependencies. If you encounter issues:

```bash
# Rebuild without cache
docker-compose build --no-cache
```

### File Upload Size Limits

Increase in nginx config:

```nginx
client_max_body_size 100M;
```

## Backup and Restore

### Backup Container Data

```bash
docker export liteparse-worker > liteparse-worker-backup.tar
```

### Save Image

```bash
docker save liteparse-worker > liteparse-worker-image.tar
```

### Load Image on Another Server

```bash
docker load < liteparse-worker-image.tar
```

## Security Best Practices

1. **Use environment variables for secrets**
2. **Run behind reverse proxy with SSL**
3. **Keep Docker and dependencies updated**
4. **Limit container resources**
5. **Use non-root user in container** (already configured in Dockerfile)
6. **Enable firewall on VPS**

## Performance Optimization

### Use Docker BuildKit

```bash
DOCKER_BUILDKIT=1 docker-compose build
```

### Multi-stage Build (Optional)

For smaller image size, the current Dockerfile is already optimized using Alpine Linux.

### Resource Limits

Adjust in docker-compose.yml based on your VPS specs:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 4G
    reservations:
      cpus: '2'
      memory: 1G
```

## Maintenance

### Clean Up Old Images

```bash
docker image prune -a
```

### Clean Up Unused Volumes

```bash
docker volume prune
```

### View Disk Usage

```bash
docker system df
```

## Support

If you encounter issues:
1. Check logs: `docker-compose logs -f`
2. Verify all dependencies are installed in container
3. Check VPS resources (CPU, RAM, disk)
4. Ensure ports are open in firewall
