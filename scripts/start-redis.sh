#!/bin/bash
# Start Redis container on virtual-assistant-network
# Run this on production if Redis is not running

set -e

echo "=========================================="
echo "Starting Redis Container"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

NETWORK_NAME="virtual-assistant-network"
REDIS_CONTAINER="virtual-assistant-redis"
REDIS_VOLUME="shared_redis_data"

# Check if Redis is already running
if docker ps --format "{{.Names}}" | grep -qE "^(${REDIS_CONTAINER}|redis)$"; then
    RUNNING_REDIS=$(docker ps --format "{{.Names}}" | grep -E "^(${REDIS_CONTAINER}|redis)$" | head -1)
    echo -e "${GREEN}✓${NC} Redis is already running: $RUNNING_REDIS"
    echo ""
    echo "Checking if it's on the network..."
    if docker inspect "$RUNNING_REDIS" --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null | grep -q "$NETWORK_NAME"; then
        echo -e "${GREEN}✓${NC} Redis is on $NETWORK_NAME"
        exit 0
    else
        echo -e "${YELLOW}Connecting Redis to network...${NC}"
        docker network connect "$NETWORK_NAME" "$RUNNING_REDIS"
        echo -e "${GREEN}✓${NC} Redis connected to network"
        exit 0
    fi
fi

# Check if network exists
if ! docker network ls | grep -q "$NETWORK_NAME"; then
    echo -e "${RED}✗${NC} Network $NETWORK_NAME does not exist"
    echo "  Create it with: docker network create $NETWORK_NAME"
    exit 1
fi

# Check if volume exists, create if not
if ! docker volume inspect "$REDIS_VOLUME" >/dev/null 2>&1; then
    echo -e "${YELLOW}Creating Redis volume...${NC}"
    docker volume create "$REDIS_VOLUME"
    echo -e "${GREEN}✓${NC} Volume created"
fi

# Start Redis container
echo -e "${GREEN}Starting Redis container...${NC}"
docker run -d \
  --name "$REDIS_CONTAINER" \
  --network "$NETWORK_NAME" \
  -v "$REDIS_VOLUME:/data" \
  --restart unless-stopped \
  redis:7-alpine redis-server --appendonly yes

echo -e "${GREEN}✓${NC} Redis container started"
echo ""

# Wait a moment for Redis to start
sleep 2

# Verify Redis is running and healthy
if docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Redis is responding to ping"
else
    echo -e "${YELLOW}⚠${NC} Redis may still be starting up"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Redis setup complete!${NC}"
echo "=========================================="
echo ""
echo "Redis container: $REDIS_CONTAINER"
echo "Network: $NETWORK_NAME"
echo "Volume: $REDIS_VOLUME"
echo ""
echo "Test connection from cursor-runner:"
echo "  docker exec cursor-runner getent hosts redis"
echo ""




