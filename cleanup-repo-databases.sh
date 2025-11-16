#!/bin/bash

# Script to remove repository-specific database files
# This ensures cursor-cli uses the shared database via MCP config

set -e

CONTAINER_NAME="cursor-runner"
REPOSITORIES_PATH="/cursor/repositories"

echo "=== Cleaning up repository-specific databases ==="
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container ${CONTAINER_NAME} is not running"
    echo "Start it with: cd cursor-runner && docker-compose up -d"
    exit 1
fi

# Find and remove all .db files in repositories directory
echo "Searching for database files in ${REPOSITORIES_PATH}..."
DB_FILES=$(docker exec ${CONTAINER_NAME} find ${REPOSITORIES_PATH} -type f -name "*.db" 2>/dev/null || true)

if [ -z "$DB_FILES" ]; then
    echo "No database files found in repositories directory"
else
    echo "Found the following database files:"
    echo "$DB_FILES"
    echo ""
    read -p "Do you want to remove these files? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$DB_FILES" | while read -r db_file; do
            if [ -n "$db_file" ]; then
                echo "Removing: $db_file"
                docker exec ${CONTAINER_NAME} rm -f "$db_file" || echo "Warning: Failed to remove $db_file"
            fi
        done
        echo ""
        echo "Cleanup complete!"
    else
        echo "Cleanup cancelled"
    fi
fi

echo ""
echo "=== Verifying MCP configuration ==="

# Ensure .cursor directory exists
docker exec ${CONTAINER_NAME} mkdir -p /root/.cursor

# Check if MCP config is mounted
if docker exec ${CONTAINER_NAME} test -f /root/.cursor/mcp.json; then
    echo "✓ MCP config found at /root/.cursor/mcp.json"
    echo ""
    echo "MCP config contents:"
    docker exec ${CONTAINER_NAME} cat /root/.cursor/mcp.json
else
    echo "✗ MCP config not found at /root/.cursor/mcp.json"
    echo ""
    echo "The MCP config should be mounted from ./mcp.json"
    echo "Check docker-compose.yml volume mount configuration"
fi

echo ""
echo "=== Summary ==="
echo "1. Repository-specific databases should be removed"
echo "2. MCP config should be at /root/.cursor/mcp.json"
echo "3. Shared database should be at /app/shared_db/shared.sqlite3"
echo ""
echo "To verify shared database access, run:"
echo "  docker exec ${CONTAINER_NAME} ls -la /app/shared_db/shared.sqlite3"

