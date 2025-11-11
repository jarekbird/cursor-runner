# Dockerfile for cursor-runner Node.js application
FROM node:18-slim

# Install system dependencies
RUN apt-get update -qq && apt-get install -y \
    build-essential \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Note: cursor-cli should be installed separately or mounted as a volume
# For now, we assume it's available in the host system and will be mounted
# or installed via a volume mount

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

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

