# Restart Instructions for Conversation UI

## Problem
Traefik is seeing `localhost` instead of your domain name, causing SSL certificate errors.

## Solution

The `.env` file must be in the same directory as `docker-compose.yml`, and you need to ensure the environment variable is available when docker-compose processes the labels.

### Option 1: Source .env file and restart (Recommended)

```bash
cd cursor-runner

# Make sure .env file exists with DOMAIN_NAME
cat .env | grep DOMAIN_NAME
# Should show: DOMAIN_NAME=n8n.srv1099656.hstgr.cloud

# Source the .env file to load variables into current shell
set -a
source .env
set +a

# Verify it's loaded
echo $DOMAIN_NAME
# Should output: n8n.srv1099656.hstgr.cloud

# Force recreate container (docker-compose will use the environment variable)
docker compose up -d --force-recreate cursor-runner

# Wait a few seconds for the service to start
sleep 5

# Test the service directly
docker exec cursor-runner curl http://localhost:3001/health
docker exec cursor-runner curl http://localhost:3001/api/list
```

### Option 2: Export variable explicitly

```bash
cd cursor-runner

# Read DOMAIN_NAME from .env and export it
export DOMAIN_NAME=$(grep DOMAIN_NAME .env | cut -d '=' -f2)

# Verify
echo $DOMAIN_NAME

# Restart container
DOMAIN_NAME=$DOMAIN_NAME docker compose up -d --force-recreate cursor-runner

# Wait and test
sleep 5
docker exec cursor-runner curl http://localhost:3001/health
```

### Option 3: Use env_file in docker-compose.yml

If the above doesn't work, we can add `env_file: .env` to the service definition, but this only affects the container environment, not the labels. For labels, we need the variable in the shell environment.

## Verify It Worked

1. **Check Traefik logs:**
   ```bash
   docker logs virtual-assistant-traefik --tail 20 | grep conversations
   ```
   Should NOT see "localhost" errors anymore.

2. **Check container labels:**
   ```bash
   docker inspect cursor-runner | grep -A 5 "Host"
   ```
   Should show your domain name, not localhost.

3. **Test the UI:**
   - Open: `https://n8n.srv1099656.hstgr.cloud/conversations`
   - Should load the conversation history UI

## Troubleshooting

If curl still fails after waiting:
```bash
# Check container logs
docker logs cursor-runner --tail 50

# Check if service is running
docker ps | grep cursor-runner

# Check container health
docker inspect cursor-runner | grep -A 10 Health
```

