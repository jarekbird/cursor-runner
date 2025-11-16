# MCP Connection Troubleshooting Guide

## Problem: cursor-cli Can't Access cursor-agents Tools

When cursor-cli says "I don't have direct access to cursor-agents tools", it means the MCP server isn't starting or connecting properly.

## Root Causes

### 1. MCP Config Not Found
- **Location**: `/root/.cursor/mcp.json`
- **Fix**: The `docker-entrypoint.sh` script runs `merge-mcp-config.js` on startup to create this file
- **Verify**: Check container logs for "✓ MCP config found"

### 2. Redis Connection Failure
- **Issue**: The cursor-agents MCP server needs Redis to initialize
- **Error**: MCP server crashes with `process.exit(1)` if Redis is unreachable
- **Fix**: Ensure Redis is accessible from cursor-runner container
  - Redis should be at `redis://redis:6379/0` (Docker network)
  - Both containers must be on `virtual-assistant-network`

### 3. cursor-agents Code Not Built
- **Location**: `/app/target/cursor-agents/dist/mcp/index.js`
- **Fix**: Ensure cursor-agents is built (`npm run build` in cursor-agents directory)
- **Verify**: Check container logs for "✓ cursor-agents MCP server found"

## Debugging Steps

### 1. Check Container Logs
```bash
docker compose logs cursor-runner | grep -i mcp
```

Look for:
- "✓ MCP config found"
- "✓ cursor-agents MCP server found"
- "✓ Redis is reachable"
- Any error messages

### 2. Test MCP Server Manually
```bash
# Inside cursor-runner container
docker compose exec cursor-runner bash

# Test MCP server startup
export REDIS_URL="redis://redis:6379/0"
export NODE_ENV="production"
node /app/target/cursor-agents/dist/mcp/index.js
```

You should see:
```
cursor-agents MCP server: Starting initialization...
cursor-agents MCP server: QueueManager initialized successfully
cursor-agents MCP server: MCP server started and ready for connections
```

If you see errors, they'll be written to stderr.

### 3. Verify Redis Connectivity
```bash
# Inside cursor-runner container
docker compose exec cursor-runner bash

# Test Redis connection
nc -z redis 6379 && echo "Redis is reachable" || echo "Redis is NOT reachable"
```

### 4. Check MCP Config
```bash
# Inside cursor-runner container
docker compose exec cursor-runner cat /root/.cursor/mcp.json
```

Should show:
```json
{
  "mcpServers": {
    "cursor-agents": {
      "command": "node",
      "args": ["/app/target/cursor-agents/dist/mcp/index.js"],
      "env": {
        "REDIS_URL": "redis://redis:6379/0",
        "NODE_ENV": "production"
      }
    }
  }
}
```

### 5. Test with cursor-cli
When cursor-cli tries to use the MCP connection, check its stderr output. The MCP server now writes detailed error messages to stderr that should be visible.

## Common Issues

### Issue: "MCP server failed to start"
**Cause**: Redis connection failure
**Solution**: 
1. Verify Redis container is running: `docker compose ps redis`
2. Verify network: Both containers on `virtual-assistant-network`
3. Check REDIS_URL in MCP config matches actual Redis location

### Issue: "cursor-agents MCP server not found"
**Cause**: cursor-agents not built or not mounted
**Solution**:
1. Build cursor-agents: `cd cursor-agents && npm run build`
2. Verify volume mount in docker-compose.yml
3. Check file exists: `ls -la /app/target/cursor-agents/dist/mcp/index.js`

### Issue: "MCP config not found"
**Cause**: merge script didn't run
**Solution**:
1. Check entrypoint script is being used (see Dockerfile)
2. Manually run: `node /app/merge-mcp-config.js`
3. Verify `/root/.cursor` directory exists and is writable

## Verification

After fixes, verify the MCP connection works:

1. **Check startup logs**: Should see all ✓ marks
2. **Test MCP server**: Manual test should succeed
3. **Use cursor-cli**: Try creating an agent and see if tools are available

## Additional Notes

- The MCP server uses stdio transport, so errors are written to stderr
- cursor-cli should capture stderr, but if not, check container logs
- The MCP server must successfully connect to Redis before it can serve tools
- All error messages now include detailed context (REDIS_URL, stack traces, etc.)

