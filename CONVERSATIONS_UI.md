# Conversation History UI Setup

This document explains how to set up and access the conversation history UI.

## Overview

The conversation history UI is served by **jarek-va-ui** (React frontend) at `/conversations` on your domain via Traefik reverse proxy.
The API endpoints are served by **cursor-runner** at `/conversations/api/*`.

## Prerequisites

1. **DOMAIN_NAME environment variable must be set**
   - This should be the same `DOMAIN_NAME` used across all services
   - Typically set in a `.env` file in the `cursor-runner` directory
   - Example: `DOMAIN_NAME=jarekva.com`

2. **Traefik must be running**
   - Traefik is defined in `cursor-runner/docker-compose.yml`
   - Must be on the same `virtual-assistant-network` as cursor-runner

## Configuration

The UI is configured via Traefik labels in `jarek-va-ui/docker-compose.yml`:
- Path-based routing at `/conversations` (serves React UI)
- Strips `/conversations` prefix before forwarding to jarek-va-ui service
- Uses HTTPS with Let's Encrypt certificates
- Security headers enabled

The API is configured via Traefik labels in `cursor-runner/docker-compose.yml`:
- Path-based routing at `/conversations/api/*` (routes to cursor-runner API)
- Higher priority (20) ensures API routes are matched before UI routes
- Strips `/conversations` prefix before forwarding to cursor-runner service

## Deployment

### Deploying jarek-va-ui (Frontend)

After code changes to jarek-va-ui, you need to **restart the container** for Traefik to pick up the new labels:

```bash
cd jarek-va-ui

# Make sure DOMAIN_NAME is set (same as jarek-va)
export DOMAIN_NAME=n8n.srv1099656.hstgr.cloud  # or set in .env file

# Force recreate container to ensure Traefik picks up new labels
DOMAIN_NAME=$DOMAIN_NAME docker compose up -d --force-recreate jarek-va-ui
```

### Deploying cursor-runner (API Backend)

After code changes to cursor-runner API, you need to **restart the container**:

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

3. **Check Traefik has detected the services:**
   - Access Traefik dashboard at `http://your-server-ip:8080`
   - Look for `jarek-va-ui` router (serves UI at `/conversations`)
   - Look for `cursor-runner-conversations-api` router (serves API at `/conversations/api/*`)

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

2. **Test API service directly (bypassing Traefik):**
   ```bash
   docker exec cursor-runner curl http://localhost:3001/api/list
   ```
   Should return JSON array of conversations

3. **Test UI service directly (bypassing Traefik):**
   ```bash
   docker exec jarek-va-ui curl http://localhost/
   ```
   Should return HTML page

4. **Check API service health:**
   ```bash
   docker exec cursor-runner curl http://localhost:3001/health
   ```

5. **Check UI service health:**
   ```bash
   docker exec jarek-va-ui wget --quiet --tries=1 --spider http://localhost/
   ```

## How It Works

1. **UI Request Flow:**
   - Browser requests `https://domain.com/conversations`
   - Traefik receives request, matches `jarek-va-ui` router (priority 10)
   - Traefik strips `/conversations` prefix
   - Traefik forwards request to `jarek-va-ui:80/`
   - Nginx serves React app from `/usr/share/nginx/html`

2. **API Request Flow:**
   - Browser/React app requests `https://domain.com/conversations/api/list`
   - Traefik receives request, matches `cursor-runner-conversations-api` router (priority 20, higher than UI)
   - Traefik strips `/conversations` prefix
   - Traefik forwards request to `cursor-runner:3001/api/list`
   - Express router mounted at `/api` handles the request

3. **Route Mapping:**
   - `/conversations` → jarek-va-ui: `/` (serves React UI)
   - `/conversations/api/list` → cursor-runner: `/api/list` (API endpoint)
   - `/conversations/api/:id` → cursor-runner: `/api/:id` (API endpoint)

4. **JavaScript Fetch:**
   - React app uses relative paths: `/conversations/api/list`, `/conversations/api/:id`
   - Browser resolves relative to current page URL (`/conversations`)
   - Traefik routes API requests to cursor-runner, UI requests to jarek-va-ui

## Related Services

- **jarek-va-ui**: React frontend application (serves UI at `/conversations`)
- **cursor-runner**: Node.js backend (serves API at `/conversations/api/*`)
- **Traefik**: Defined in `cursor-runner/docker-compose.yml` (routes traffic)
- **Redis**: Stores conversation data (shared with cursor-agents)
- **cursor-agents**: Similar Traefik setup at `/agents`

