#!/bin/bash

# Script to initialize Docker volumes and networks required for Virtual Assistant services
# This should be run before starting services, especially on the server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Initializing Docker Resources ===${NC}"
echo ""

# Network name
NETWORK_NAME="virtual-assistant-network"

# Volume names
SHARED_SQLITE_DB="shared_sqlite_db"
SHARED_REDIS_DATA="shared_redis_data"
CURSOR_RUNNER_REPOSITORIES="cursor_runner_repositories"

# 1. Create network if it doesn't exist
echo -e "${GREEN}Step 1:${NC} Checking Docker network..."
if docker network ls | grep -q "$NETWORK_NAME"; then
    echo -e "  ${GREEN}✓${NC} Network $NETWORK_NAME already exists"
else
    echo -e "  ${YELLOW}Creating network $NETWORK_NAME...${NC}"
    docker network create "$NETWORK_NAME"
    echo -e "  ${GREEN}✓${NC} Network $NETWORK_NAME created successfully"
fi
echo ""

# 2. Create shared SQLite database volume if it doesn't exist
# Note: This volume is defined in cursor-runner/docker-compose.yml
echo -e "${GREEN}Step 2:${NC} Checking shared SQLite database volume..."
if docker volume inspect "$SHARED_SQLITE_DB" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Volume $SHARED_SQLITE_DB already exists"
else
    echo -e "  ${YELLOW}Creating volume $SHARED_SQLITE_DB...${NC}"
    docker volume create "$SHARED_SQLITE_DB"
    echo -e "  ${GREEN}✓${NC} Volume $SHARED_SQLITE_DB created successfully"
fi
echo ""

# 3. Create shared Redis data volume if it doesn't exist
# Note: This volume is defined in cursor-runner/docker-compose.yml
echo -e "${GREEN}Step 3:${NC} Checking shared Redis data volume..."
if docker volume inspect "$SHARED_REDIS_DATA" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Volume $SHARED_REDIS_DATA already exists"
else
    echo -e "  ${YELLOW}Creating volume $SHARED_REDIS_DATA...${NC}"
    docker volume create "$SHARED_REDIS_DATA"
    echo -e "  ${GREEN}✓${NC} Volume $SHARED_REDIS_DATA created successfully"
fi
echo ""

# 4. Create cursor-runner repositories volume if it doesn't exist
echo -e "${GREEN}Step 4:${NC} Checking cursor-runner repositories volume..."
if docker volume inspect "$CURSOR_RUNNER_REPOSITORIES" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Volume $CURSOR_RUNNER_REPOSITORIES already exists"
else
    echo -e "  ${YELLOW}Creating volume $CURSOR_RUNNER_REPOSITORIES...${NC}"
    docker volume create "$CURSOR_RUNNER_REPOSITORIES"
    echo -e "  ${GREEN}✓${NC} Volume $CURSOR_RUNNER_REPOSITORIES created successfully"
fi
echo ""

# 5. Set proper permissions on volumes (if needed)
echo -e "${GREEN}Step 5:${NC} Setting permissions on volumes..."
# SQLite volume permissions
docker run --rm \
    -v "$SHARED_SQLITE_DB:/data" \
    alpine sh -c "chmod -R 777 /data 2>/dev/null || true" >/dev/null 2>&1

echo -e "  ${GREEN}✓${NC} Permissions set"
echo ""

# Summary
echo -e "${BLUE}=== Summary ===${NC}"
echo ""
echo "Network:"
docker network inspect "$NETWORK_NAME" --format '  Name: {{.Name}}, Driver: {{.Driver}}' 2>/dev/null || echo "  Network not found"
echo ""
echo "Volumes:"
docker volume inspect "$SHARED_SQLITE_DB" --format '  Name: {{.Name}}, Driver: {{.Driver}}' 2>/dev/null || echo "  Volume $SHARED_SQLITE_DB not found"
docker volume inspect "$SHARED_REDIS_DATA" --format '  Name: {{.Name}}, Driver: {{.Driver}}' 2>/dev/null || echo "  Volume $SHARED_REDIS_DATA not found"
docker volume inspect "$CURSOR_RUNNER_REPOSITORIES" --format '  Name: {{.Name}}, Driver: {{.Driver}}' 2>/dev/null || echo "  Volume $CURSOR_RUNNER_REPOSITORIES not found"
echo ""
echo -e "${GREEN}✓${NC} Docker resources initialized successfully!"
echo ""
echo "You can now start services with:"
echo "  cd cursor-runner && docker-compose up -d  # Start cursor-runner first (defines shared volumes)"
echo "  cd jarek-va && docker-compose up -d"
echo "  cd cursor-agents && docker-compose up -d"




