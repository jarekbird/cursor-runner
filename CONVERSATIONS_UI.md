# Conversation History UI Setup

This document explains how to set up and access the conversation history UI.

## Overview

The conversation history UI is accessible at `/conversations` on your domain via Traefik reverse proxy.

## Prerequisites

1. **DOMAIN_NAME environment variable must be set**
   - This should be the same `DOMAIN_NAME` used for `jarek-va` and `cursor-agents`
   - Typically set in a `.env` file in the `jarek-va` directory
   - Example: `DOMAIN_NAME=n8n.srv1099656.hstgr.cloud`

2. **Traefik must be running**
   - Traefik is defined in `jarek-va/docker-compose.yml`
   - Must be on the same `virtual-assistant-network` as cursor-runner

## Configuration

The UI is configured via Traefik labels in `docker-compose.yml`:
- Path-based routing at `/conversations`
- Strips `/conversations` prefix before forwarding to the service
- Uses HTTPS with Let's Encrypt certificates
- Security headers enabled

## Deployment

After code changes, you need to **restart the container** for Traefik to pick up the new labels:

```bash
cd cursor-runner

# Make sure DOMAIN_NAME is set (same as jarek-va)
export DOMAIN_NAME=n8n.srv1099656.hstgr.cloud  # or set in .env file

# Force recreate container to ensure Traefik picks up new labels
DOMAIN_NAME=$DOMAIN_NAME docker compose up -d --force-recreate cursor-runner
```

Or if using the GitHub Actions deployment, it will automatically:
- Pass `DOMAIN_NAME` from secrets/environment
- Force recreate the container

## Access

Once deployed, the UI is available at:
- **Main UI**: `https://${DOMAIN_NAME}/conversations`
- **API List**: `https://${DOMAIN_NAME}/conversations/api/list`
- **API Get**: `https://${DOMAIN_NAME}/conversations/api/:conversationId`

## Troubleshooting

### 404 Not Found

1. **Check DOMAIN_NAME is set:**
   ```bash
   echo $DOMAIN_NAME
   # Should output your domain, e.g., n8n.srv1099656.hstgr.cloud
   ```

2. **Check container is running:**
   ```bash
   docker ps | grep cursor-runner
   ```

3. **Check Traefik has detected the service:**
   - Access Traefik dashboard at `http://your-server-ip:8080`
   - Look for `cursor-runner-conversations` in HTTP routers

4. **Restart the container:**
   ```bash
   cd cursor-runner
   DOMAIN_NAME=$DOMAIN_NAME docker compose up -d --force-recreate cursor-runner
   ```

5. **Check Traefik logs:**
   ```bash
   docker logs virtual-assistant-traefik | grep conversations
   ```

6. **Check cursor-runner logs:**
   ```bash
   docker logs cursor-runner | grep conversations
   ```

### Service Not Accessible

1. **Verify network connectivity:**
   ```bash
   docker network inspect virtual-assistant-network
   ```
   Should show both `cursor-runner` and `virtual-assistant-traefik`

2. **Test service directly (bypassing Traefik):**
   ```bash
   docker exec cursor-runner curl http://localhost:3001/api/list
   ```
   Should return JSON array of conversations

3. **Check service health:**
   ```bash
   docker exec cursor-runner curl http://localhost:3001/health
   ```

## How It Works

1. **Request Flow:**
   - Browser requests `https://domain.com/conversations`
   - Traefik receives request, matches router rule
   - Traefik strips `/conversations` prefix
   - Traefik forwards request to `cursor-runner:3001/`
   - Service router mounted at `/` handles the request

2. **Route Mapping:**
   - `/conversations` → Service: `/` (serves HTML UI)
   - `/conversations/api/list` → Service: `/api/list` (API endpoint)
   - `/conversations/api/:id` → Service: `/api/:id` (API endpoint)

3. **JavaScript Fetch:**
   - UI uses relative paths: `api/list`, `api/:id`
   - Browser resolves relative to current page URL
   - Traefik strips prefix, service receives correct path

## Related Services

- **Traefik**: Defined in `jarek-va/docker-compose.yml`
- **Redis**: Stores conversation data (shared with cursor-agents)
- **cursor-agents**: Similar Traefik setup at `/agents`

