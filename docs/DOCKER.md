# Docker Setup for cursor-runner

This Node.js application uses Docker Compose with an external network to communicate with `jarek-va`.

## Prerequisites

1. **Docker** and **Docker Compose** installed
2. **Shared Docker Network** created (see setup below)
3. **jarek-va directory** accessible (for volume mount)

## Setup

### 1. Create Shared Network

Before starting the services, create the shared Docker network:

```bash
# From the root VirtualAssistant directory
# Make the script executable (one-time setup)
chmod +x ../create-network.sh

# Create the network
../create-network.sh

# Or manually:
docker network create virtual-assistant-network
```

**Important**: This network must be created before starting the services. It allows cursor-runner and jarek-va to communicate.

### 2. Update Volume Path

Edit `docker-compose.yml` and update the volume mount path to point to your jarek-va directory:

```yaml
volumes:
  - ../jarek-va:/app/target/jarek-va  # Adjust this path as needed
```

If jarek-va is in a different location, use an absolute path:

```yaml
volumes:
  - /path/to/jarek-va:/app/target/jarek-va
```

### 3. Environment Variables

Create a `.env` file in the `cursor-runner` directory (optional, defaults are in docker-compose.yml):

```env
NODE_ENV=production
CURSOR_CLI_PATH=cursor
CURSOR_CLI_TIMEOUT=300000
CURSOR_API_KEY=your-cursor-api-key-here
TARGET_APP_TYPE=rails
GIT_COMMAND_TIMEOUT=60000
TERMINAL_COMMAND_TIMEOUT=300000
JAREK_VA_API_KEY=your-api-key
```

### 4. Start Service

```bash
cd cursor-runner
docker-compose up -d
```

## Communication with jarek-va

cursor-runner communicates with jarek-va using the Docker service name:

- **Service name**: `app` (from jarek-va's docker-compose.yml)
- **URL**: `http://app:3000`
- **Configured via**: `JAREK_VA_URL` environment variable (set in docker-compose.yml)

The services communicate through the shared `virtual-assistant-network` Docker network.

## Accessing jarek-va Codebase

cursor-runner accesses the jarek-va codebase via a mounted volume:

- **Container path**: `/app/target/jarek-va`
- **Host path**: `../jarek-va` (relative to cursor-runner directory)
- **Configured via**: `TARGET_APP_PATH` environment variable

This allows cursor-runner to:
- Read/write files in jarek-va
- Run tests in jarek-va
- Execute commands in jarek-va directory

## Usage

### View Logs

```bash
docker-compose logs -f
docker-compose logs -f cursor-runner
```

### Stop Service

```bash
docker-compose down
```

### Rebuild After Changes

```bash
docker-compose build
docker-compose up -d
```

### Access Service

- **cursor-runner API**: http://localhost:3001
- **Health check**: http://localhost:3001/health

## Production Deployment

When deploying to a production server, complete these root-level operations:

### 1. Initial Server Setup

```bash
# Make the network creation script executable
chmod +x /path/to/VirtualAssistant/create-network.sh

# Create the shared Docker network
/path/to/VirtualAssistant/create-network.sh
```

### 2. Docker Permissions

```bash
# Add user to docker group (if not already)
sudo usermod -aG docker $USER

# Log out and back in for changes to take effect
# Or use: newgrp docker
```

### 3. Create Required Directories

```bash
# In cursor-runner directory
cd /path/to/VirtualAssistant/cursor-runner
mkdir -p logs repositories
chmod 755 logs repositories
```

### 4. Firewall Configuration

```bash
# Allow required ports
sudo ufw allow 3001/tcp  # cursor-runner API

# Enable firewall (if not already)
sudo ufw enable
```

### 5. Update Volume Path

Edit `docker-compose.yml` and update the volume mount path to point to your jarek-va directory:

```yaml
volumes:
  - /path/to/jarek-va:/app/target/jarek-va  # Use absolute path in production
```

### 6. Environment Variables (Optional)

Most configuration is in `docker-compose.yml`, but you can override with a `.env` file:

```env
NODE_ENV=production
CURSOR_CLI_PATH=cursor
CURSOR_CLI_TIMEOUT=300000
CURSOR_API_KEY=your-cursor-api-key-here
TARGET_APP_TYPE=rails
GIT_COMMAND_TIMEOUT=60000
TERMINAL_COMMAND_TIMEOUT=300000
JAREK_VA_API_KEY=your-api-key
```

**Important**: Never commit `.env` files. Use a secrets management system in production.

### 7. Start Service

```bash
cd /path/to/VirtualAssistant/cursor-runner
docker-compose up -d
```

### 8. Verify Deployment

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Test health endpoint
curl http://localhost:3001/health

# Check network connectivity
docker network inspect virtual-assistant-network

# Verify volume mount
docker-compose exec cursor-runner ls -la /app/target/jarek-va
```

### 9. Log Rotation (Optional)

Configure log rotation for Docker containers:

```bash
# Create logrotate configuration
sudo nano /etc/logrotate.d/docker-virtual-assistant

# Add configuration (example):
# /var/lib/docker/containers/*/*.log {
#   rotate 7
#   daily
#   compress
#   size=1M
#   missingok
#   delaycompress
#   copytruncate
# }
```

## Troubleshooting

### Network Not Found

If you get an error about the network not existing:

```bash
# Make script executable first
chmod +x /path/to/VirtualAssistant/create-network.sh

# Create the network
/path/to/VirtualAssistant/create-network.sh

# Or manually:
docker network create virtual-assistant-network
```

### jarek-va Not Reachable

1. Ensure jarek-va is running: `cd ../jarek-va && docker-compose ps`
2. Check both services are on the same network:
   ```bash
   docker network inspect virtual-assistant-network
   ```
3. Verify service names match:
   - cursor-runner looks for: `app` (service name in jarek-va's docker-compose.yml)
   - jarek-va looks for: `cursor-runner` (service name in cursor-runner's docker-compose.yml)
4. Check environment variables:
   ```bash
   docker-compose exec cursor-runner env | grep JAREK_VA
   ```

### Volume Mount Issues

If cursor-runner can't access jarek-va codebase:

1. Check the volume path in docker-compose.yml is correct (use absolute path in production)
2. Verify the jarek-va directory exists at that path
3. Check volume mount: `docker-compose exec cursor-runner ls -la /app/target/jarek-va`
4. Verify permissions on the host directory:
   ```bash
   ls -la /path/to/jarek-va
   chmod 755 /path/to/jarek-va  # If needed
   ```

### cursor-cli Not Found

cursor-cli is automatically installed in the Docker container during the build process. If cursor-runner can't find cursor-cli:

1. Rebuild the Docker image to ensure cursor-cli is installed:
   ```bash
   docker-compose build --no-cache cursor-runner
   docker-compose up -d cursor-runner
   ```

2. Verify cursor-cli is accessible:
   ```bash
   docker-compose exec cursor-runner which cursor
   docker-compose exec cursor-runner cursor --version
   ```

3. Check the build logs for any installation errors:
   ```bash
   docker-compose build cursor-runner 2>&1 | grep -i cursor
   ```

4. If installation fails, you can manually install it in a running container (temporary fix):
   ```bash
   docker-compose exec cursor-runner bash -c "curl https://cursor.com/install -fsS | bash"
   docker-compose restart cursor-runner
   ```

