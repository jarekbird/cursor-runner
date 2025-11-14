# Docker Troubleshooting Guide

## Colima/Docker Daemon Issues

### Issue: "Cannot connect to the Docker daemon"

If you see errors like:
```
Cannot connect to the Docker daemon at unix:///Users/jarekbird/.colima/default/docker.sock
```

### Solution 1: Start Colima Manually

```bash
# Start Colima directly (not via brew services)
colima start

# Check status
colima status
```

### Solution 2: Fix Colima Bootstrap Error

If you get:
```
Bootstrap failed: 5: Input/output error
Error: Failure while executing; `/bin/launchctl bootstrap gui/501 /Users/jarekbird/Library/LaunchAgents/homebrew.mxcl.colima.plist` exited with 5.
```

Try these steps:

1. **Stop any existing Colima instances:**
   ```bash
   colima stop
   colima delete
   ```

2. **Remove the launch agent:**
   ```bash
   rm ~/Library/LaunchAgents/homebrew.mxcl.colima.plist
   ```

3. **Restart Colima:**
   ```bash
   colima start
   ```

4. **If still failing, try with sudo (for richer errors):**
   ```bash
   sudo brew services start colima
   ```

### Solution 3: Use Docker Desktop Instead

If Colima continues to have issues, consider using Docker Desktop:

1. Install Docker Desktop for Mac
2. Start Docker Desktop
3. Docker should be available at the default socket

### Solution 4: Validate Without Docker

You can validate the Docker configuration without Docker running:

```bash
cd cursor-runner
./validate-docker.sh
```

This will check:
- Dockerfile syntax
- docker-compose.yml structure
- Required files exist
- YAML validity

## Docker Build Issues

### Issue: "npm ci" fails

**Problem**: `npm ci` requires `package-lock.json`

**Solution**: Ensure `package-lock.json` exists:
```bash
cd cursor-runner
npm install  # This will generate package-lock.json
```

### Issue: Build fails with "COPY failed"

**Problem**: Files being copied don't exist or are excluded by `.dockerignore`

**Solution**: Check `.dockerignore` and ensure required files aren't excluded:
```bash
cat .dockerignore
```

### Issue: Health check fails

**Problem**: Health check runs before server is ready

**Solution**: The `start_period` in the healthcheck gives the server time to start. If it still fails:
1. Check server logs: `docker-compose logs cursor-runner`
2. Verify the server starts correctly
3. Increase `start_period` if needed

## Network Issues

### Issue: "network virtual-assistant-network not found"

**Problem**: External network doesn't exist

**Solution**: Create the network first:
```bash
# From root VirtualAssistant directory
chmod +x create-network.sh
./create-network.sh

# Or manually:
docker network create virtual-assistant-network
```

### Issue: Services can't communicate

**Problem**: Services are on different networks or network doesn't exist

**Solution**:
1. Verify network exists: `docker network ls | grep virtual-assistant-network`
2. Check both services are on the network: `docker network inspect virtual-assistant-network`
3. Verify service names match in both docker-compose.yml files

## Volume Mount Issues

### Issue: "volume mount failed" or "path does not exist"

**Problem**: Volume path in docker-compose.yml is incorrect

**Solution**: 
1. Check the path in `docker-compose.yml`:
   ```yaml
   volumes:
     - ../jarek-va:/app/target/jarek-va
   ```
2. Use absolute path in production:
   ```yaml
   volumes:
     - /absolute/path/to/jarek-va:/app/target/jarek-va
   ```
3. Verify the directory exists: `ls -la ../jarek-va`

## Port Conflicts

### Issue: "port is already allocated"

**Problem**: Port 3001 is already in use

**Solution**:
1. Find what's using the port:
   ```bash
   lsof -i :3001
   ```
2. Stop the conflicting service
3. Or change the port in docker-compose.yml:
   ```yaml
   ports:
     - "3002:3001"  # Use different host port
   ```

## Debugging Commands

### Check Docker Status
```bash
docker ps
docker-compose ps
colima status
```

### View Logs
```bash
# cursor-runner logs
docker-compose logs cursor-runner

# Follow logs
docker-compose logs -f cursor-runner

# Last 100 lines
docker-compose logs --tail=100 cursor-runner
```

### Inspect Container
```bash
# Enter container
docker-compose exec cursor-runner sh

# Check environment variables
docker-compose exec cursor-runner env

# Check if files exist
docker-compose exec cursor-runner ls -la /app
```

### Rebuild from Scratch
```bash
# Stop and remove containers
docker-compose down

# Remove images
docker-compose rm -f

# Rebuild without cache
docker-compose build --no-cache

# Start services
docker-compose up -d
```

## Cursor CLI Installation Issues

### Issue: "cursor-cli not available: spawn cursor ENOENT"

**Problem**: The cursor CLI is not installed or not found in the container's PATH.

**Solution 1: Rebuild the Docker image**
```bash
cd cursor-runner
docker-compose build --no-cache cursor-runner
docker-compose up -d cursor-runner
```

**Solution 2: Verify cursor CLI installation in container**
```bash
# Check if cursor binary exists (should be in /usr/local/bin)
docker-compose exec cursor-runner ls -la /usr/local/bin/cursor
docker-compose exec cursor-runner ls -la /usr/local/bin/cursor-agent

# Check the cursor library directory
docker-compose exec cursor-runner ls -la /usr/local/lib/cursor/

# Check PATH (should include /usr/local/bin by default)
docker-compose exec cursor-runner echo $PATH

# Try to find cursor
docker-compose exec cursor-runner which cursor
docker-compose exec cursor-runner find /usr/local -name cursor* -type f

# Try to run cursor
docker-compose exec cursor-runner cursor --version
```

**Solution 3: Manual installation in running container (temporary)**
```bash
# Enter the container
docker-compose exec cursor-runner bash

# Inside container, install cursor CLI
curl -fsSL https://cursor.com/install | bash

# Verify installation
which cursor
cursor --version

# Exit and restart
exit
docker-compose restart cursor-runner
```

**Solution 4: Check build logs for installation errors**
```bash
# Rebuild and check for cursor installation errors
docker-compose build cursor-runner 2>&1 | grep -i cursor

# Or check full build output
docker-compose build cursor-runner
```

**Solution 5: Use custom cursor CLI path**
If cursor CLI is installed elsewhere or mounted from host:
```yaml
# In docker-compose.yml
environment:
  - CURSOR_CLI_PATH=/path/to/cursor
```

**Note**: The cursor CLI installation script (`https://cursor.com/install`) installs "Cursor Agent" which provides the `cursor` command. The Dockerfile:
1. Runs the official installer
2. Finds the `cursor-agent` binary after installation
3. Copies it to `/usr/local/lib/cursor/`
4. Creates symlinks in `/usr/local/bin/` for both `cursor-agent` and `cursor`

If the installation fails, it may be due to:
- Network issues during build
- The install script not working in non-interactive Docker builds
- Architecture mismatch (the script should detect Linux/ARM automatically)
- The `cursor-agent` binary not being found after installation (check build logs)

## Getting Help

If issues persist:

1. **Check Docker/Colima logs:**
   ```bash
   colima logs
   docker info
   ```

2. **Validate configuration:**
   ```bash
   cd cursor-runner
   ./validate-docker.sh
   ```

3. **Check system resources:**
   ```bash
   # Colima resources
   colima status
   
   # Docker system info
   docker system df
   ```

4. **Review documentation:**
   - See [DOCKER.md](./DOCKER.md) for setup instructions
   - See [README.md](../README.md) for general information



