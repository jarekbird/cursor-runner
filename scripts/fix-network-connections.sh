#!/bin/bash
# Fix network connections - connect containers to virtual-assistant-network
# Run this on production to ensure all containers are on the network

set -e

echo "=========================================="
echo "Fixing Network Connections"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

NETWORK_NAME="virtual-assistant-network"

# Check if network exists
if ! docker network ls | grep -q "$NETWORK_NAME"; then
    echo -e "${RED}✗${NC} Network $NETWORK_NAME does not exist"
    echo "  Create it with: docker network create $NETWORK_NAME"
    exit 1
fi

echo -e "${GREEN}✓${NC} Network $NETWORK_NAME exists"
echo ""

# Function to connect container to network
connect_container() {
    local container_name=$1
    local display_name=${2:-$container_name}
    
    if docker ps -a --format "{{.Names}}" | grep -q "^${container_name}$"; then
        if docker inspect "$container_name" --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null | grep -q "$NETWORK_NAME"; then
            echo -e "  ${GREEN}✓${NC} $display_name is already on $NETWORK_NAME"
            return 0
        else
            echo -e "  ${YELLOW}Connecting $display_name to network...${NC}"
            if docker network connect "$NETWORK_NAME" "$container_name" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} $display_name connected successfully"
                return 0
            else
                echo -e "  ${RED}✗${NC} Failed to connect $display_name (container may need to be restarted)"
                return 1
            fi
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} $display_name container not found (skipping)"
        return 2
    fi
}

# Connect containers
echo -e "${GREEN}Step 1:${NC} Connecting containers to network..."
echo ""

NEEDS_RESTART=false

# Connect cursor-runner
if connect_container "cursor-runner" "cursor-runner"; then
    if [ $? -eq 1 ]; then
        NEEDS_RESTART=true
    fi
fi

# Connect Redis (check common names)
REDIS_CONNECTED=false
for redis_name in virtual-assistant-redis redis; do
    result=$(connect_container "$redis_name" "Redis ($redis_name)" 2>&1)
    echo "$result"
    if echo "$result" | grep -q "connected successfully"; then
        REDIS_CONNECTED=true
        break
    fi
done

# Connect cursor-agents
connect_container "cursor-agents" "cursor-agents"

echo ""

# Show current network status
echo -e "${GREEN}Step 2:${NC} Current network status..."
NETWORK_CONTAINERS=$(docker network inspect "$NETWORK_NAME" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "")
if [ -n "$NETWORK_CONTAINERS" ]; then
    echo -e "  ${GREEN}Containers on $NETWORK_NAME:${NC}"
    for container in $NETWORK_CONTAINERS; do
        echo "    - $container"
    done
else
    echo -e "  ${YELLOW}⚠${NC} No containers found on network"
fi
echo ""

# Test DNS resolution
echo -e "${GREEN}Step 3:${NC} Testing DNS resolution..."
if docker ps --format "{{.Names}}" | grep -q "^cursor-runner$"; then
    if docker exec cursor-runner getent hosts redis >/dev/null 2>&1; then
        REDIS_IP=$(docker exec cursor-runner getent hosts redis | awk '{print $1}')
        echo -e "  ${GREEN}✓${NC} cursor-runner can resolve 'redis' to: $REDIS_IP"
    else
        echo -e "  ${RED}✗${NC} cursor-runner cannot resolve 'redis'"
        if [ "$REDIS_CONNECTED" = "false" ]; then
            echo -e "  ${YELLOW}→${NC} Redis container may not be on the network"
        fi
    fi
else
    echo -e "  ${YELLOW}⚠${NC} cursor-runner is not running (cannot test DNS)"
fi
echo ""

# Recommendations
echo "=========================================="
echo "Next Steps"
echo "=========================================="
echo ""

if [ "$NEEDS_RESTART" = "true" ] || [ "$REDIS_CONNECTED" = "false" ]; then
    echo "Some containers may need to be restarted:"
    echo ""
    if [ "$NEEDS_RESTART" = "true" ]; then
        echo "  docker restart cursor-runner"
    fi
    if [ "$REDIS_CONNECTED" = "false" ]; then
        echo "  # Start Redis if it's not running:"
        echo "  docker run -d \\"
        echo "    --name virtual-assistant-redis \\"
        echo "    --network $NETWORK_NAME \\"
        echo "    -v shared_redis_data:/data \\"
        echo "    --restart unless-stopped \\"
        echo "    redis:7-alpine redis-server --appendonly yes"
    fi
    echo ""
fi

echo "After connecting containers, check cursor-runner logs:"
echo "  docker logs cursor-runner | grep -i redis"
echo ""


