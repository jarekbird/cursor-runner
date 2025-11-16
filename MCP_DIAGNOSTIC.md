# MCP Connection Diagnostic Guide

## Problem: cursor-cli Can See Config But Not Tools

If cursor-cli says it can see the MCP config but tools aren't available, the MCP server is likely crashing when cursor-cli tries to connect.

## Quick Diagnostic

Run this inside the cursor-runner container:

```bash
docker compose exec cursor-runner bash /app/diagnose-mcp.sh
```

This will check:
1. MCP config exists at `/root/.cursor/mcp.json`
2. cursor-agents MCP server file exists
3. Redis is reachable
4. MCP server can start

## Manual Testing

### 1. Test MCP Server Startup

```bash
docker compose exec cursor-runner bash

export REDIS_URL="redis://redis:6379/0"
export NODE_ENV="production"
node /app/target/cursor-agents/dist/mcp/index.js
```

**Expected output:**
```
cursor-agents MCP server: Starting initialization...
cursor-agents MCP server: REDIS_URL {"REDIS_URL":"redis://redis:6379/0"}
cursor-agents MCP server: Initializing QueueManager...
cursor-agents MCP server: QueueManager initialized successfully
cursor-agents MCP server: Starting MCP server transport...
cursor-agents MCP server: MCP server started and ready for connections
```

**If you see errors:**
- Check Redis connectivity: `nc -z redis 6379`
- Check cursor-agents is built: `ls -la /app/target/cursor-agents/dist/mcp/index.js`
- Check environment variables are set correctly

### 2. Test MCP Protocol

```bash
docker compose exec cursor-runner node /app/test-mcp-protocol.js
```

This simulates what cursor-cli does when connecting.

### 3. Check cursor-cli MCP Config Location

cursor-cli might be looking for the config in a different location. Check:

```bash
docker compose exec cursor-runner ls -la /root/.cursor/
docker compose exec cursor-runner cat /root/.cursor/mcp.json
```

## Common Issues

### Issue: MCP Server Crashes on Startup

**Symptoms:**
- MCP server exits immediately
- Error messages in stderr about Redis connection

**Solution:**
1. Verify Redis is running: `docker compose ps redis`
2. Verify network: Both containers on `virtual-assistant-network`
3. Test Redis connection: `nc -z redis 6379`
4. Check REDIS_URL in MCP config matches actual Redis location

### Issue: MCP Server Starts But Tools Not Available

**Symptoms:**
- MCP server starts successfully
- cursor-cli can't see tools

**Possible causes:**
1. **cursor-cli needs restart**: MCP connections are established at startup
2. **MCP server not responding to requests**: Check if server handles initialize request
3. **Config location mismatch**: cursor-cli might be reading from different location

**Solution:**
1. Restart cursor-cli / Cursor IDE
2. Check cursor-cli logs for MCP connection errors
3. Verify MCP config is at `/root/.cursor/mcp.json` (where cursor-cli expects it)

### Issue: cursor-cli Can't Spawn MCP Server

**Symptoms:**
- No error messages
- Tools just don't appear

**Possible causes:**
1. **File permissions**: MCP server file not executable
2. **Node.js not in PATH**: When cursor-cli spawns the server
3. **Environment variables not passed**: REDIS_URL not available to spawned process

**Solution:**
1. Check file permissions: `ls -la /app/target/cursor-agents/dist/mcp/index.js`
2. Verify node is in PATH: `which node`
3. Check MCP config includes env vars (should be in mcp.json)

## Verification Steps

After fixing issues:

1. **Restart cursor-runner container:**
   ```bash
   docker compose restart cursor-runner
   ```

2. **Check startup logs:**
   ```bash
   docker compose logs cursor-runner | grep -i mcp
   ```
   
   Should see:
   - ✓ MCP config found
   - ✓ cursor-agents MCP server found
   - ✓ Redis is reachable

3. **Test MCP server manually:**
   ```bash
   docker compose exec cursor-runner node /app/test-mcp-protocol.js
   ```

4. **Restart cursor-cli / Cursor IDE** to pick up MCP connections

5. **Check if tools are available** in cursor-cli

## Debugging Tips

### Enable Verbose Logging

The MCP server now logs to stderr. When cursor-cli spawns it, check:

```bash
# In another terminal, watch cursor-runner logs
docker compose logs -f cursor-runner
```

Then try using cursor-cli - you should see MCP server startup messages.

### Check MCP Server Process

```bash
docker compose exec cursor-runner ps aux | grep "mcp/index.js"
```

If the process isn't running, cursor-cli isn't spawning it (config issue).

If the process crashes immediately, check stderr output.

### Verify MCP Config Format

```bash
docker compose exec cursor-runner cat /root/.cursor/mcp.json | python3 -m json.tool
```

Should be valid JSON with:
- `mcpServers.cursor-agents.command` = "node"
- `mcpServers.cursor-agents.args` = ["/app/target/cursor-agents/dist/mcp/index.js"]
- `mcpServers.cursor-agents.env.REDIS_URL` = "redis://redis:6379/0"

## Next Steps

If all diagnostics pass but tools still aren't available:

1. Check cursor-cli version - older versions might not support MCP
2. Check cursor-cli logs for specific error messages
3. Try manually invoking the MCP server to see if it responds
4. Verify the MCP protocol version matches what cursor-cli expects

