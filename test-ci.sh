#!/bin/bash

# Test CI Workflow Steps
# This script runs all the steps from .github/workflows/test.yml locally
# Use this to verify changes before committing/pushing

set -e  # Exit on any error

echo "=========================================="
echo "Running CI Test Workflow Steps"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Checkout code (skip - we're already in the repo)
echo -e "${GREEN}Step 1:${NC} Checking code location..."
if [ ! -f "package.json" ]; then
  echo -e "${RED}✗ Error: Not in cursor-runner directory${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Code location verified"
echo ""

# Step 2: Set up Node.js
echo -e "${GREEN}Step 2:${NC} Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "  Node.js version: $NODE_VERSION"

# Check if Node.js version is 18+
NODE_MAJOR=$(echo $NODE_VERSION | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}✗ Error: Node.js 18+ required, found $NODE_VERSION${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js version OK"
echo ""

# Step 3: Install dependencies
echo -e "${GREEN}Step 3:${NC} Installing dependencies..."
if ! npm ci; then
  echo -e "${RED}✗ Error: npm ci failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Dependencies installed"
echo ""

# Detect changed files
echo -e "${GREEN}Step 3.5:${NC} Detecting changed files..."
CHANGED_FILES=$(node scripts/get-changed-files.js 2>/dev/null || echo "[]")
HAS_CHANGES=false

# Check if there are any changed JS files in src/ or tests/
if echo "$CHANGED_FILES" | grep -qE '(src/|tests/)'; then
  HAS_CHANGES=true
  CHANGED_COUNT=$(echo "$CHANGED_FILES" | grep -E '(src/|tests/)' | wc -l | tr -d ' ')
  echo "  Found $CHANGED_COUNT changed file(s)"
else
  echo "  No changed files detected (will run all tests)"
fi
echo ""

# Step 4: Run linter
echo -e "${GREEN}Step 4:${NC} Running linter..."
if [ "$HAS_CHANGES" = "true" ]; then
  echo "  Linting changed files..."
  if ! npm run lint:changed 2>/dev/null; then
    echo "  Falling back to linting all files..."
    if ! npm run lint; then
      echo -e "${RED}✗ Error: Linting failed${NC}"
      echo -e "${YELLOW}Tip: Run 'npm run lint:fix' to auto-fix some issues${NC}"
      exit 1
    fi
  fi
else
  echo "  No changes detected, linting all files..."
  if ! npm run lint; then
    echo -e "${RED}✗ Error: Linting failed${NC}"
    echo -e "${YELLOW}Tip: Run 'npm run lint:fix' to auto-fix some issues${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} Linting passed"
echo ""

# Step 5: Check code formatting
echo -e "${GREEN}Step 5:${NC} Checking code formatting..."
if [ "$HAS_CHANGES" = "true" ]; then
  echo "  Checking formatting of changed files..."
  if ! npm run format:check:changed 2>/dev/null; then
    echo "  Falling back to checking all files..."
    if ! npm run format:check; then
      echo -e "${RED}✗ Error: Code formatting check failed${NC}"
      echo -e "${YELLOW}Tip: Run 'npm run format' to auto-format code${NC}"
      exit 1
    fi
  fi
else
  echo "  No changes detected, checking all files..."
  if ! npm run format:check; then
    echo -e "${RED}✗ Error: Code formatting check failed${NC}"
    echo -e "${YELLOW}Tip: Run 'npm run format' to auto-format code${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} Code formatting OK"
echo ""

# Step 6: Run Jest tests
echo -e "${GREEN}Step 6:${NC} Running Jest tests..."
export NODE_OPTIONS=--experimental-vm-modules
if [ "$HAS_CHANGES" = "true" ]; then
  echo "  Running tests for changed files..."
  if ! npm run test:changed 2>/dev/null; then
    echo "  Falling back to running all tests..."
    if ! npm test; then
      echo -e "${RED}✗ Error: Tests failed${NC}"
      exit 1
    fi
  fi
else
  echo "  No changes detected, running all tests..."
  if ! npm test; then
    echo -e "${RED}✗ Error: Tests failed${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} All tests passed"
echo ""

# Step 7: Generate test coverage
echo -e "${GREEN}Step 7:${NC} Generating test coverage..."
if [ "$HAS_CHANGES" = "true" ]; then
  echo "  Generating coverage for changed files..."
  if ! npm run test:coverage:changed 2>/dev/null; then
    echo "  Falling back to generating full coverage..."
    if ! npm run test:coverage; then
      echo -e "${RED}✗ Error: Coverage generation failed${NC}"
      exit 1
    fi
  fi
else
  echo "  No changes detected, generating full coverage..."
  if ! npm run test:coverage; then
    echo -e "${RED}✗ Error: Coverage generation failed${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} Coverage generated"
echo ""

# Step 8: Verify coverage files exist
echo -e "${GREEN}Step 8:${NC} Verifying coverage files..."
if [ ! -f "coverage/lcov.info" ]; then
  echo -e "${RED}✗ Error: coverage/lcov.info not found${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Coverage file exists: coverage/lcov.info"
echo ""

echo "=========================================="
echo -e "${GREEN}✓ All CI test steps passed!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✓ Node.js version check"
echo "  ✓ Dependencies installed"
if [ "$HAS_CHANGES" = "true" ]; then
  echo "  ✓ Changed files detected and tested"
fi
echo "  ✓ Linting passed"
echo "  ✓ Code formatting OK"
echo "  ✓ All tests passed"
echo "  ✓ Coverage generated"
echo ""
echo "Ready to commit and push!"

