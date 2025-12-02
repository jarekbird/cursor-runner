#!/bin/bash

# Script to access the shared SQLite database from the host
# This allows the cursor CLI (via MCP connector) to access the database
# that is shared across Docker containers

VOLUME_NAME="shared_sqlite_db"
MOUNT_POINT="${HOME}/.virtual-assistant/shared-db"
DB_PATH="${MOUNT_POINT}/shared.sqlite3"
SYNC_CONTAINER="shared-db-sync"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Shared SQLite Database Access ===${NC}"
echo ""

# Check if volume exists
if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo -e "${YELLOW}Volume $VOLUME_NAME does not exist. Creating it...${NC}"
    docker volume create "$VOLUME_NAME"
    echo -e "${GREEN}Volume created successfully${NC}"
fi

# Create mount point directory
mkdir -p "$MOUNT_POINT"

# Check if sync container is already running
if docker ps --format '{{.Names}}' | grep -q "^${SYNC_CONTAINER}$"; then
    echo -e "${GREEN}Sync container is already running${NC}"
elif docker ps -a --format '{{.Names}}' | grep -q "^${SYNC_CONTAINER}$"; then
    echo "Starting existing sync container..."
    docker start "$SYNC_CONTAINER" >/dev/null 2>&1
    echo -e "${GREEN}Sync container started${NC}"
else
    echo "Creating sync container..."
    # Create a container that syncs the volume to the host
    docker run -d \
        --name "$SYNC_CONTAINER" \
        --restart unless-stopped \
        -v "$VOLUME_NAME:/data:ro" \
        -v "$MOUNT_POINT:/mnt/host:rw" \
        alpine:latest \
        sh -c "
            while true; do
                # Sync data from volume to host (one-way sync: volume -> host)
                rsync -a /data/ /mnt/host/ 2>/dev/null || cp -r /data/* /mnt/host/ 2>/dev/null || true
                sleep 5
            done
        " >/dev/null 2>&1
    
    # Wait a moment for initial sync
    sleep 2
    echo -e "${GREEN}Sync container created and running${NC}"
fi

# Show database path
echo ""
echo -e "${GREEN}Database accessible at:${NC}"
echo "  $DB_PATH"
echo ""

# Show database info if it exists
if [ -f "$DB_PATH" ]; then
    SIZE=$(du -h "$DB_PATH" 2>/dev/null | cut -f1)
    echo -e "${GREEN}Database file exists${NC} (Size: $SIZE)"
    echo ""
    echo "Quick access commands:"
    echo "  sqlite3 $DB_PATH '.tables'                    # List tables"
    echo "  sqlite3 $DB_PATH '.schema'                    # Show schema"
    echo "  sqlite3 $DB_PATH \"SELECT * FROM ...\"       # Query data"
else
    echo -e "${YELLOW}Database file does not exist yet.${NC}"
    echo "It will be created automatically when first used by a container."
    echo ""
    echo "You can also create it manually:"
    echo "  sqlite3 $DB_PATH 'CREATE TABLE test (id INTEGER PRIMARY KEY);'"
fi

echo ""
echo -e "${BLUE}For cursor SQLite MCP connector:${NC}"
echo "  Use this path in your MCP configuration:"
echo "  $DB_PATH"
echo ""
echo -e "${BLUE}Note:${NC}"
echo "  - The sync container ($SYNC_CONTAINER) keeps the host directory in sync"
echo "  - Changes made on the host will be visible in containers"
echo "  - Changes made in containers will sync to the host (with ~5s delay)"
echo "  - To stop syncing: docker stop $SYNC_CONTAINER"
echo "  - To remove sync container: docker rm -f $SYNC_CONTAINER"






