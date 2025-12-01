# Traefik Configuration

## Overview

Traefik is now configured as a foundational service in `cursor-runner/docker-compose.yml`. This is the core reverse proxy that routes all external traffic to the appropriate services.

## Service Location

**Traefik is defined in:** `VirtualAssistant/cursor-runner/docker-compose.yml`

This makes `cursor-runner` the foundational service that manages infrastructure components (Traefik, Redis, shared volumes).

## Configuration Details

### Entrypoints

- **web** (port 80): HTTP entrypoint that redirects all traffic to HTTPS
- **websecure** (port 443): HTTPS entrypoint that serves all traffic

### Certificate Management

- **Provider**: Let's Encrypt
- **Challenge Type**: HTTP-01 challenge
- **Email**: Uses `ACME_EMAIL` environment variable, or defaults to `admin@${DOMAIN_NAME}`
- **Storage**: `/letsencrypt/acme.json` (persisted in `traefik_letsencrypt` volume)

### HTTP to HTTPS Redirect

All HTTP traffic is automatically redirected to HTTPS via a catch-all router with the `redirect-to-https` middleware.

## Routing Configuration

### Priority Order (Higher = Matched First)

1. **Priority 25**: `cursor-runner-agent-conversations-api`
   - Route: `/agent-conversations/api/*`
   - Service: `cursor-runner:3001`
   - Middleware: Strip prefix, rewrite to `/api/agent/*`, security headers

2. **Priority 20**: 
   - `cursor-runner-conversations-api` - `/conversations/api/*` → `cursor-runner:3001`
   - `elevenlabs-agent-webhooks` - `/signed-url`, `/agent-tools`, `/callback` → `elevenlabs-agent:3004`

3. **Priority 10**:
   - `cursor-agents` - `/agents/*` → `cursor-agents:3002`
   - `jarek-va-ui` - `/conversations`, `/tasks`, `/task/*` (excluding `/api/*`) → `jarek-va-ui:80`

### Service Routes

| Path | Service | Port | Priority | Notes |
|------|---------|------|----------|-------|
| `/agent-conversations/api/*` | cursor-runner | 3001 | 25 | Rewrites to `/api/agent/*` |
| `/conversations/api/*` | cursor-runner | 3001 | 20 | Strips `/conversations` prefix |
| `/signed-url`, `/agent-tools`, `/callback` | elevenlabs-agent | 3004 | 20 | Webhook endpoints |
| `/agents/*` | cursor-agents | 3002 | 10 | Strips `/agents` prefix |
| `/conversations/*` (UI) | jarek-va-ui | 80 | 10 | Strips `/conversations` prefix |
| `/tasks`, `/task/*` (UI) | jarek-va-ui | 80 | 10 | Excludes `/api/*` paths |

## Environment Variables

### Required

- `DOMAIN_NAME`: Your domain name (e.g., `jarekva.com`)
  - Used in all Traefik router rules
  - Must be set when starting services

### Optional

- `ACME_EMAIL`: Email for Let's Encrypt certificate notifications
  - Defaults to `admin@${DOMAIN_NAME}` if not set
  - Example: `ACME_EMAIL=admin@jarekva.com`

## Deployment

### Starting Traefik

```bash
cd VirtualAssistant/cursor-runner

# Set required environment variables
export DOMAIN_NAME=jarekva.com
export ACME_EMAIL=admin@jarekva.com  # Optional

# Start Traefik (and Redis)
docker compose up -d traefik redis

# Verify Traefik is running
docker ps | grep traefik
docker logs virtual-assistant-traefik
```

### Starting All Services

```bash
cd VirtualAssistant/cursor-runner

# Make sure DOMAIN_NAME is set
export DOMAIN_NAME=jarekva.com

# Start all services (Traefik, Redis, cursor-runner)
docker compose up -d

# Start other services (they'll connect via the shared network)
cd ../cursor-agents
export DOMAIN_NAME=jarekva.com
docker compose up -d

cd ../jarek-va-ui
export DOMAIN_NAME=jarekva.com
docker compose up -d

cd ../elevenlabs-agent
export DOMAIN_NAME=jarekva.com
docker compose up -d
```

## Verification

### Check Traefik is Running

```bash
# Check container status
docker ps | grep traefik

# Check logs
docker logs virtual-assistant-traefik

# Check if ports are listening
sudo lsof -i -P -n | grep LISTEN | grep -E ':(80|443)'
```

### Test Routing

```bash
# Test HTTP redirect (should redirect to HTTPS)
curl -I http://jarekva.com

# Test HTTPS (should return 200 or appropriate response)
curl -I https://jarekva.com

# Test specific routes
curl -I https://jarekva.com/conversations/api/health
curl -I https://jarekva.com/agents/health
```

### Check Certificate Status

```bash
# Check Let's Encrypt certificate storage
docker exec virtual-assistant-traefik ls -la /letsencrypt/

# Check Traefik logs for certificate provisioning
docker logs virtual-assistant-traefik | grep -i acme
```

## Troubleshooting

### Traefik Not Starting

1. **Check Docker socket access:**
   ```bash
   ls -la /var/run/docker.sock
   ```
   Traefik needs read access to discover services.

2. **Check network exists:**
   ```bash
   docker network inspect virtual-assistant-network
   ```
   If it doesn't exist, create it:
   ```bash
   docker network create virtual-assistant-network
   ```

3. **Check port conflicts:**
   ```bash
   sudo lsof -i -P -n | grep LISTEN | grep -E ':(80|443)'
   ```
   Ensure ports 80 and 443 are not in use by another service.

### Services Not Discovered

1. **Check service labels:**
   ```bash
   docker inspect cursor-runner | jq '.[0].Config.Labels'
   ```
   Verify `traefik.enable=true` is present.

2. **Check network connectivity:**
   ```bash
   docker exec virtual-assistant-traefik ping cursor-runner
   ```

3. **Check Traefik logs:**
   ```bash
   docker logs virtual-assistant-traefik | grep -i error
   ```

### SSL Certificate Issues

1. **Check DNS:**
   ```bash
   dig jarekva.com +short
   ```
   Should return your server's IP address.

2. **Check Let's Encrypt rate limits:**
   - Let's Encrypt has rate limits (50 certs per domain per week)
   - If you've been testing frequently, you may hit limits
   - Use staging environment for testing: Add `--certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory`

3. **Check certificate storage:**
   ```bash
   docker exec virtual-assistant-traefik cat /letsencrypt/acme.json
   ```
   Should contain JSON with certificate data.

### Routing Issues

1. **Check router priorities:**
   - Higher priority routes are matched first
   - API routes (priority 20-25) should match before UI routes (priority 10)

2. **Check path matching:**
   - Verify `PathPrefix` rules match your expected paths
   - Check middleware (strip prefix, rewrite) are applied correctly

3. **Test direct service access:**
   ```bash
   # Test cursor-runner directly
   docker exec cursor-runner curl http://localhost:3001/health
   
   # Test through Traefik
   curl https://jarekva.com/conversations/api/health
   ```

## Security Notes

1. **Dashboard**: Traefik dashboard is disabled by default. If you need it for debugging:
   - Enable it: `--api.dashboard=true`
   - Secure it with authentication middleware
   - Only expose it on internal network

2. **Docker Socket**: Traefik has read-only access to Docker socket (`:ro`)

3. **Security Headers**: All services use security headers middleware:
   - HSTS (HTTP Strict Transport Security)
   - SSL redirect
   - Preload enabled

## Related Services

All services connect to Traefik via the `virtual-assistant-network`:

- `cursor-runner` - API endpoints
- `cursor-agents` - Agent management UI and API
- `jarek-va-ui` - Frontend UI
- `elevenlabs-agent` - Webhook endpoints
- `redis` - Shared Redis instance

## Migration Notes

Previously, Traefik was defined in `jarek-va/docker-compose.yml`. It has been moved to `cursor-runner/docker-compose.yml` as part of making `cursor-runner` the foundational service.

Update any deployment scripts or documentation that referenced the old location.

