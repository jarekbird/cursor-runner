#!/bin/bash
# Quick script to create the Docker network and connect existing containers
# Run this on production if the network doesn't exist

set -e

echo "=========================================="
echo "Setting up virtual-assistant-network"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

NETWORK_NAME="virtual-assistant-network"

# 1. Create network if it doesn't exist
echo -e "${GREEN}Step 1:${NC} Creating network..."
if docker network ls | grep -q "$NETWORK_NAME"; then
    echo -e "  ${GREEN}✓${NC} Network $NETWORK_NAME already exists"
else
    echo -e "  ${YELLOW}Creating network $NETWORK_NAME...${NC}"
    docker network create "$NETWORK_NAME"
    echo -e "  ${GREEN}✓${NC} Network created successfully"
fi
echo ""

# 2. Connect existing containers to the network
echo -e "${GREEN}Step 2:${NC} Connecting existing containers to network..."

# Connect cursor-runner if it exists
if docker ps -a --format "{{.Names}}" | grep -q "^cursor-runner$"; then
    if docker inspect cursor-runner --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{end}}' | grep -q "$NETWORK_NAME"; then
        echo -e "  ${GREEN}✓${NC} cursor-runner is already on $NETWORK_NAME"
    else
        echo -e "  ${YELLOW}Connecting cursor-runner to network...${NC}"
        docker network connect "$NETWORK_NAME" cursor-runner || echo -e "  ${RED}✗${NC} Failed to connect cursor-runner (may need to restart container)"
    fi
fi

# Connect Redis if it exists (check common names)
for redis_name in virtual-assistant-redis redis; do
    if docker ps -a --format "{{.Names}}" | grep -q "^${redis_name}$"; then
        if docker inspect "$redis_name" --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{end}}' | grep -q "$NETWORK_NAME"; then
            echo -e "  ${GREEN}✓${NC} $redis_name is already on $NETWORK_NAME"
        else
            echo -e "  ${YELLOW}Connecting $redis_name to network...${NC}"
            docker network connect "$NETWORK_NAME" "$redis_name" || echo -e "  ${RED}✗${NC} Failed to connect $redis_name (may need to restart container)"
        fi
        break
    fi
done

# Connect cursor-agents if it exists
if docker ps -a --format "{{.Names}}" | grep -q "^cursor-agents$"; then
    if docker inspect cursor-agents --format '{{range $net, $conf := .NetworkSettings.Networks}}{{$net}}{{end}}' | grep -q "$NETWORK_NAME"; then
        echo -e "  ${GREEN}✓${NC} cursor-agents is already on $NETWORK_NAME"
    else
        echo -e "  ${YELLOW}Connecting cursor-agents to network...${NC}"
        docker network connect "$NETWORK_NAME" cursor-agents || echo -e "  ${RED}✗${NC} Failed to connect cursor-agents (may need to restart container)"
    fi
fi

echo ""

# 3. Verify network setup
echo -e "${GREEN}Step 3:${NC} Verifying network setup..."
NETWORK_CONTAINERS=$(docker network inspect "$NETWORK_NAME" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || echo "")
if [ -n "$NETWORK_CONTAINERS" ]; then
    echo -e "  ${GREEN}✓${NC} Containers on $NETWORK_NAME:"
    echo "    $NETWORK_CONTAINERS"
else
    echo -e "  ${YELLOW}⚠${NC} No containers found on network (this is OK if containers aren't running)"
fi
echo ""

echo "=========================================="
echo -e "${GREEN}Setup complete!${NC}"
echo "=========================================="
echo ""
echo "Note: If containers were already running, you may need to restart them"
echo "for the network connection to take full effect:"
echo "  docker restart cursor-runner"
echo "  docker restart virtual-assistant-redis  # if it exists"
echo ""






