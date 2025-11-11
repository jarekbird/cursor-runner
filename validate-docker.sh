#!/bin/bash

# Script to validate Dockerfile and docker-compose.yml without requiring Docker daemon

set -e

echo "Validating cursor-runner Docker configuration..."
echo ""

# Check if Dockerfile exists
if [ ! -f "Dockerfile" ]; then
    echo "❌ ERROR: Dockerfile not found"
    exit 1
fi
echo "✅ Dockerfile exists"

# Check if docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ ERROR: docker-compose.yml not found"
    exit 1
fi
echo "✅ docker-compose.yml exists"

# Check if .dockerignore exists
if [ ! -f ".dockerignore" ]; then
    echo "⚠️  WARNING: .dockerignore not found (recommended)"
else
    echo "✅ .dockerignore exists"
fi

# Validate Dockerfile syntax (basic checks)
echo ""
echo "Validating Dockerfile syntax..."

# Check for required FROM instruction
if ! grep -q "^FROM" Dockerfile; then
    echo "❌ ERROR: Dockerfile missing FROM instruction"
    exit 1
fi
echo "✅ Dockerfile has FROM instruction"

# Check for WORKDIR
if ! grep -q "^WORKDIR" Dockerfile; then
    echo "⚠️  WARNING: Dockerfile missing WORKDIR instruction"
else
    echo "✅ Dockerfile has WORKDIR instruction"
fi

# Check for package.json
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found (required for npm install)"
    exit 1
fi
echo "✅ package.json exists"

# Check for package-lock.json (recommended for npm ci)
if [ ! -f "package-lock.json" ]; then
    echo "⚠️  WARNING: package-lock.json not found (npm ci requires it)"
else
    echo "✅ package-lock.json exists"
fi

# Check for src directory
if [ ! -d "src" ]; then
    echo "❌ ERROR: src directory not found"
    exit 1
fi
echo "✅ src directory exists"

# Check for main entry point
if [ ! -f "src/index.js" ]; then
    echo "❌ ERROR: src/index.js not found (main entry point)"
    exit 1
fi
echo "✅ src/index.js exists"

# Validate docker-compose.yml (basic YAML check)
echo ""
echo "Validating docker-compose.yml syntax..."

# Check if it's valid YAML (basic check - requires yq or python)
if command -v python3 &> /dev/null; then
    if python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" 2>/dev/null; then
        echo "✅ docker-compose.yml is valid YAML"
    else
        echo "⚠️  WARNING: docker-compose.yml may have YAML syntax issues"
    fi
else
    echo "⚠️  SKIPPED: Cannot validate YAML (python3 not available)"
fi

# Check for required services
if ! grep -q "cursor-runner:" docker-compose.yml; then
    echo "❌ ERROR: docker-compose.yml missing cursor-runner service"
    exit 1
fi
echo "✅ docker-compose.yml has cursor-runner service"

# Check for network configuration
if ! grep -q "virtual-assistant-network" docker-compose.yml; then
    echo "⚠️  WARNING: docker-compose.yml missing virtual-assistant-network"
else
    echo "✅ docker-compose.yml references virtual-assistant-network"
fi

echo ""
echo "✅ Docker configuration validation complete!"
echo ""
echo "Note: To actually build the image, Docker daemon must be running."
echo "Try: docker-compose build"


