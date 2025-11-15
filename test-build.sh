#!/bin/bash

# Script to test Docker build process (requires Docker daemon)
# This will attempt to build and show any errors

set -e

echo "Testing cursor-runner Docker build..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ ERROR: Docker daemon is not running"
    echo ""
    echo "Please start Docker/Colima:"
    echo "  colima start"
    echo "  # or"
    echo "  # Start Docker Desktop"
    exit 1
fi

echo "✅ Docker daemon is running"
echo ""

# Check if network exists (required for docker-compose)
if ! docker network ls | grep -q "virtual-assistant-network"; then
    echo "⚠️  WARNING: virtual-assistant-network does not exist"
    echo "Creating network..."
    docker network create virtual-assistant-network || true
    echo "✅ Network created"
else
    echo "✅ Network exists"
fi

echo ""
echo "Building Docker image..."
echo ""

# Build the image
if docker-compose build; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "Next steps:"
    echo "  1. Start the service: docker-compose up -d"
    echo "  2. Check logs: docker-compose logs -f"
    echo "  3. Test health: curl http://localhost:3001/health"
else
    echo ""
    echo "❌ Build failed!"
    echo ""
    echo "Common issues:"
    echo "  1. Missing package-lock.json - run: npm install"
    echo "  2. Network issues - check internet connection"
    echo "  3. Docker daemon issues - restart Docker/Colima"
    exit 1
fi














