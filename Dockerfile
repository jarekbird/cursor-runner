# Dockerfile for cursor-runner Node.js application
FROM node:18-slim

# Install system dependencies
RUN apt-get update -qq && apt-get install -y \
    build-essential \
    python3 \
    make \
    curl \
    git \
    ca-certificates \
    procps \
    psmisc \
    netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

# Install cursor-agent (Cursor CLI)
# The official installer installs cursor-agent which provides the cursor command
RUN curl -fsSL https://cursor.com/install | bash || true

# Verify cursor-agent installation and create symlinks if needed
# Also check common installation locations
RUN if [ -f /usr/local/lib/cursor/cursor-agent ]; then \
      mkdir -p /usr/local/bin && \
      ln -sf /usr/local/lib/cursor/cursor-agent /usr/local/bin/cursor-agent && \
      ln -sf /usr/local/lib/cursor/cursor-agent /usr/local/bin/cursor && \
      echo "cursor-agent symlinks created in /usr/local/bin"; \
    elif [ -f /root/.local/bin/cursor-agent ]; then \
      mkdir -p /usr/local/bin && \
      ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent && \
      ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor && \
      echo "cursor-agent symlinks created from /root/.local/bin"; \
    elif command -v cursor-agent >/dev/null 2>&1; then \
      CURSOR_PATH=$(command -v cursor-agent) && \
      mkdir -p /usr/local/bin && \
      ln -sf "$CURSOR_PATH" /usr/local/bin/cursor-agent && \
      ln -sf "$CURSOR_PATH" /usr/local/bin/cursor && \
      echo "cursor-agent symlinks created from found location: $CURSOR_PATH"; \
    else \
      echo "Warning: cursor-agent not found after installation - may need to be mounted or installed manually"; \
    fi

# Ensure /usr/local/bin is in PATH (should be by default, but make it explicit)
ENV PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"

# Verify cursor-agent is accessible (non-blocking - allows build to continue if not found)
RUN (which cursor-agent && cursor-agent --version) || echo "Note: cursor-agent verification skipped - ensure it's available at runtime"

# Install MCP server packages globally to avoid npx download delays during cursor-cli startup
# This prevents cursor-cli from hanging while waiting for npx to download packages
# Note: If command names don't match, verify with: npm list -g --depth=0
# Note: Using @liangshanli/mcp-server-redis as the official @modelcontextprotocol/server-redis doesn't exist yet
# Note: Gmail MCP server (@modelcontextprotocol/server-gmail) doesn't exist in npm registry yet, will use npx when needed
# Note: Atlassian MCP server (@modelcontextprotocol/server-atlassian) uses npx -y, will download on demand
RUN npm install -g mcp-server-sqlite-npx @liangshanli/mcp-server-redis && \
    echo "MCP server packages installed globally"

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (including dev dependencies for TypeScript build)
# Use npm ci if package-lock.json exists, otherwise fall back to npm install
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy application code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Remove .d.ts files from migrations directory (they cause migration errors)
RUN find dist/migrations/files -type f -name "*.d.ts" -delete

# Remove dev dependencies to reduce image size (optional - comment out if you need them)
RUN npm prune --omit=dev

# Create necessary directories
RUN mkdir -p logs repositories /root/.cursor

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Health check (using node since curl might not be available)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use entrypoint script to merge MCP config before starting
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Start the server (using compiled JavaScript from dist/)
CMD ["node", "dist/index.js"]

