#!/bin/bash
# Check Redis connectivity and status
# Run this on production to diagnose Redis issues

set -e

echo "=========================================="
echo "Redis Diagnostic Script"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if Redis container is running
echo -e "${GREEN}Step 1:${NC} Checking if Redis container is running..."
if docker ps --format "{{.Names}}" | grep -qE "(redis|virtual-assistant-redis)"; then
    REDIS_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "(redis|virtual-assistant-redis)" | head -1)
    echo -e "  ${GREEN}✓${NC} Redis container found: $REDIS_CONTAINER"
    docker ps --filter "name=$REDIS_CONTAINER" --format "  Status: {{.Status}}"
else
    echo -e "  ${RED}✗${NC} No Redis container found"
    echo -e "  ${YELLOW}→${NC} Redis container is not running"
fi
echo ""

# 2. Check if Redis is on the virtual-assistant-network
echo -e "${GREEN}Step 2:${NC} Checking if Redis is on virtual-assistant-network..."
if docker network inspect virtual-assistant-network >/dev/null 2>&1; then
    NETWORK_CONTAINERS=$(docker network inspect virtual-assistant-network --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "")
    if echo "$NETWORK_CONTAINERS" | grep -qE "(redis|virtual-assistant-redis)"; then
        echo -e "  ${GREEN}✓${NC} Redis is on virtual-assistant-network"
        echo "  Containers on network: $NETWORK_CONTAINERS"
    else
        echo -e "  ${RED}✗${NC} Redis is NOT on virtual-assistant-network"
        echo "  Containers on network: $NETWORK_CONTAINERS"
    fi
else
    echo -e "  ${RED}✗${NC} virtual-assistant-network does not exist"
fi
echo ""

# 3. Check if cursor-runner can resolve Redis hostname
echo -e "${GREEN}Step 3:${NC} Checking DNS resolution from cursor-runner container..."
if docker ps --format "{{.Names}}" | grep -q "cursor-runner"; then
    if docker exec cursor-runner getent hosts redis >/dev/null 2>&1; then
        REDIS_IP=$(docker exec cursor-runner getent hosts redis | awk '{print $1}')
        echo -e "  ${GREEN}✓${NC} cursor-runner can resolve 'redis' to: $REDIS_IP"
    else
        echo -e "  ${RED}✗${NC} cursor-runner cannot resolve 'redis' hostname"
    fi
    
    # Also check virtual-assistant-redis
    if docker exec cursor-runner getent hosts virtual-assistant-redis >/dev/null 2>&1; then
        REDIS_IP=$(docker exec cursor-runner getent hosts virtual-assistant-redis | awk '{print $1}')
        echo -e "  ${GREEN}✓${NC} cursor-runner can resolve 'virtual-assistant-redis' to: $REDIS_IP"
    else
        echo -e "  ${YELLOW}⚠${NC} cursor-runner cannot resolve 'virtual-assistant-redis' hostname"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} cursor-runner container is not running"
fi
echo ""

# 4. Test Redis connectivity from cursor-runner
echo -e "${GREEN}Step 4:${NC} Testing Redis connectivity from cursor-runner..."
if docker ps --format "{{.Names}}" | grep -q "cursor-runner"; then
    if docker exec cursor-runner node -e "
        const Redis = require('ioredis');
        const redis = new Redis('redis://redis:6379/0', { lazyConnect: true, enableOfflineQueue: false });
        redis.connect().then(() => {
            console.log('SUCCESS: Connected to Redis');
            redis.quit();
            process.exit(0);
        }).catch((e) => {
            console.log('ERROR: ' + e.message);
            process.exit(1);
        });
    " 2>&1; then
        echo -e "  ${GREEN}✓${NC} cursor-runner can connect to Redis"
    else
        echo -e "  ${RED}✗${NC} cursor-runner cannot connect to Redis"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} cursor-runner container is not running"
fi
echo ""

# 5. Check Redis port accessibility
echo -e "${GREEN}Step 5:${NC} Checking Redis port 6379..."
if docker ps --format "{{.Names}}" | grep -qE "(redis|virtual-assistant-redis)"; then
    REDIS_CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "(redis|virtual-assistant-redis)" | head -1)
    if docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} Redis is responding to ping on port 6379"
    else
        echo -e "  ${RED}✗${NC} Redis is not responding to ping"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Cannot test - Redis container not found"
fi
echo ""

# 6. Summary and recommendations
echo "=========================================="
echo "Summary and Recommendations"
echo "=========================================="
echo ""

if docker ps --format "{{.Names}}" | grep -qE "(redis|virtual-assistant-redis)"; then
    echo -e "${GREEN}✓${NC} Redis container is running"
else
    echo -e "${RED}✗${NC} Redis container is NOT running"
    echo ""
    echo "To start Redis, run one of:"
    echo "  1. If you have a main docker-compose.yml with Redis:"
    echo "     docker compose up -d redis"
    echo ""
    echo "  2. Or start Redis manually:"
    echo "     docker run -d \\"
    echo "       --name virtual-assistant-redis \\"
    echo "       --network virtual-assistant-network \\"
    echo "       -v shared_redis_data:/data \\"
    echo "       redis:7-alpine redis-server --appendonly yes"
fi

if docker network inspect virtual-assistant-network >/dev/null 2>&1; then
    NETWORK_CONTAINERS=$(docker network inspect virtual-assistant-network --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "")
    if echo "$NETWORK_CONTAINERS" | grep -qE "(redis|virtual-assistant-redis)"; then
        echo -e "${GREEN}✓${NC} Redis is on the correct network"
    else
        echo -e "${RED}✗${NC} Redis is NOT on virtual-assistant-network"
        echo "  → Connect Redis to the network:"
        echo "    docker network connect virtual-assistant-network virtual-assistant-redis"
    fi
else
    echo -e "${RED}✗${NC} virtual-assistant-network does not exist"
    echo "  → Create it: docker network create virtual-assistant-network"
fi

echo ""


