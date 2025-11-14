# Dockerfile for cursor-runner Node.js application
FROM node:18-slim

# Install system dependencies
RUN apt-get update -qq && apt-get install -y \
    build-essential \
    curl \
    git \
    ca-certificates \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Install Cursor CLI using official installer
# See: https://cursor.com/docs/cli/overview
RUN curl https://cursor.com/install -fsS | bash && \
    CURSOR_DIR=$(find /root /home -name cursor-agent -type f 2>/dev/null | head -1 | xargs dirname) && \
    if [ -n "$CURSOR_DIR" ] && [ -d "$CURSOR_DIR" ]; then \
        mkdir -p /usr/local/lib/cursor && \
        cp -r "$CURSOR_DIR"/* /usr/local/lib/cursor/ && \
        mkdir -p /usr/local/bin && \
        ln -sf /usr/local/lib/cursor/cursor-agent /usr/local/bin/cursor-agent && \
        ln -sf /usr/local/bin/cursor-agent /usr/local/bin/cursor; \
    else \
        echo "ERROR: cursor-agent directory not found after installation" && \
        echo "Searching for cursor-agent..." && \
        find /root /home -name cursor-agent -type f 2>/dev/null || true && \
        exit 1; \
    fi

# Verify cursor CLI is accessible and fail build if not found
RUN which cursor || (echo "ERROR: cursor command not found in PATH" && exit 1) && \
    cursor --version || (echo "ERROR: cursor --version failed" && exit 1)

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
# Use npm ci if package-lock.json exists, otherwise fall back to npm install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs repositories

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Health check (using node since curl might not be available)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "src/index.js"]

