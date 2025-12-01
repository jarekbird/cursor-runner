# Production Redis Diagnostic Guide

## Quick Checks to Run on Production

### 1. Check if Redis Container is Running

```bash
docker ps | grep redis
# Should show: virtual-assistant-redis
```

If nothing shows, Redis is not running.

### 2. Check if Redis is on the Network

```bash
docker network inspect virtual-assistant-network --format '{{range .Containers}}{{.Name}} {{end}}'
# Should include: virtual-assistant-redis
```

### 3. Check if cursor-runner can resolve Redis

```bash
docker exec cursor-runner getent hosts redis
# Should show: 172.x.x.x    redis
```

### 4. Run the Diagnostic Script

```bash
cd cursor-runner
./scripts/check-redis.sh
```

This will run all checks and provide recommendations.

## Solutions

### Option 1: Start Redis from Main docker-compose.yml

If you have a main `docker-compose.yml` that includes Redis:

```bash
cd /path/to/main/docker-compose
docker compose up -d redis
```

### Option 2: Start Redis Manually

If Redis isn't defined in docker-compose, start it manually:

```bash
docker run -d \
  --name virtual-assistant-redis \
  --network virtual-assistant-network \
  -v shared_redis_data:/data \
  --restart unless-stopped \
  redis:7-alpine redis-server --appendonly yes
```

### Option 3: Add Redis to cursor-runner docker-compose.yml

If you want Redis managed by cursor-runner, add this to `cursor-runner/docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: virtual-assistant-redis
    restart: unless-stopped
    volumes:
      - shared_redis_data:/data
    networks:
      - virtual-assistant-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  cursor-runner:
    # ... existing cursor-runner config ...
    depends_on:
      redis:
        condition: service_healthy
```

Then restart:

```bash
cd cursor-runner
docker compose up -d
```

## Important Notes

- **Redis is in Docker** - You don't need to install Redis on the VPS host
- **Network is critical** - Both Redis and cursor-runner must be on `virtual-assistant-network`
- **Service name matters** - cursor-runner connects to `redis://redis:6379/0`, so the container/service must be named `redis` OR you need to use the container name `virtual-assistant-redis` in the connection URL
- **Volume persistence** - Redis data is stored in `shared_redis_data` volume

## Troubleshooting

### Error: "getaddrinfo ENOTFOUND redis"

This means cursor-runner cannot resolve the `redis` hostname. Check:

1. Is Redis container running? (`docker ps | grep redis`)
2. Is Redis on the same network? (`docker network inspect virtual-assistant-network`)
3. Can cursor-runner resolve it? (`docker exec cursor-runner getent hosts redis`)

### Error: "Connection refused"

Redis is running but not accepting connections. Check:

1. Is Redis healthy? (`docker exec virtual-assistant-redis redis-cli ping`)
2. Is port 6379 accessible? (should be internal to Docker network)

### Redis works but cursor-runner still can't connect

Try using the container name instead:

```bash
# In cursor-runner container, set:
REDIS_URL=redis://virtual-assistant-redis:6379/0
```

Or add an alias in docker-compose.yml:

```yaml
networks:
  virtual-assistant-network:
    external: true
    name: virtual-assistant-network
    # Add alias for redis
    aliases:
      - redis
```




