#!/bin/bash

# Deploy Script
# This script runs CI tests and then pushes to origin
# Use this to deploy changes after verifying they pass all tests
#
# Prerequisites:
# - Node.js 18+ (use nvm with .nvmrc)
# - npm dependencies installed (npm install)
# - Git repository initialized
# - NO Ruby or bundle required (this is a Node.js project)

set -e  # Exit on any error

echo "=========================================="
echo "Deploy Script - Test & Push"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify we're in the right directory
echo -e "${GREEN}Step 1:${NC} Verifying directory..."
if [ ! -f "package.json" ]; then
  echo -e "${RED}✗ Error: Not in cursor-runner directory${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Directory verified"
echo ""

# Step 2: Run all tests and linting
# Note: This script uses npm commands only - no Ruby/bundle required
echo -e "${GREEN}Step 2:${NC} Running linting for all files..."
if ! npm run lint; then
  echo -e "${RED}✗ Error: Linting failed. Deployment aborted.${NC}"
  echo -e "${YELLOW}Tip: Run 'npm run lint:fix' to auto-fix some issues${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Linting passed"
echo ""

echo -e "${GREEN}Step 2.5:${NC} Checking code formatting for all files..."
if ! npm run format:check; then
  echo -e "${RED}✗ Error: Code formatting check failed. Deployment aborted.${NC}"
  echo -e "${YELLOW}Tip: Run 'npm run format' to auto-format code${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Code formatting OK"
echo ""

echo -e "${GREEN}Step 2.6:${NC} Running all tests..."
export NODE_OPTIONS=--experimental-vm-modules
if ! npm test; then
  echo -e "${RED}✗ Error: Tests failed. Deployment aborted.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} All tests passed"
echo ""

echo -e "${GREEN}Step 2.7:${NC} Generating test coverage..."
if ! npm run test:coverage; then
  echo -e "${RED}✗ Error: Coverage generation failed. Deployment aborted.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Coverage generated"
echo ""

# Step 3: Check git status and commit changes
echo -e "${GREEN}Step 3:${NC} Checking git status..."
if ! git status &>/dev/null; then
  echo -e "${RED}✗ Error: Not a git repository${NC}"
  exit 1
fi

COMMITTED_CHANGES=false

# Check if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${GREEN}Step 3.5:${NC} Staging and committing changes..."
  echo "  The following files will be committed:"
  git status --short
  echo ""
  
  # Stage all changes
  if ! git add -A; then
    echo -e "${RED}✗ Error: Failed to stage changes${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓${NC} All changes staged"
  
  # Generate commit message using cursor-agent
  echo ""
  echo -e "${GREEN}Step 3.6:${NC} Generating commit message with cursor-agent..."
  
  # Get the diff of staged changes (limit to first 5000 lines to avoid huge prompts)
  STAGED_DIFF=$(git diff --cached | head -5000)
  CHANGED_FILES=$(git diff --cached --name-only | head -20)
  NEW_FILES=$(git diff --cached --name-only --diff-filter=A | head -20)
  MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=M | head -20)
  DELETED_FILES=$(git diff --cached --name-only --diff-filter=D | head -20)
  DIFF_SUMMARY=$(git diff --cached --stat | head -30)
  
  # If no diff (only new files), create a summary
  if [ -z "$STAGED_DIFF" ] && [ -n "$NEW_FILES" ]; then
    STAGED_DIFF="New files added:
$(echo "$NEW_FILES" | sed 's/^/  - /')"
  fi
  
  # Build prompt for cursor-agent using heredoc to safely handle special characters
  CURSOR_PROMPT_FILE=$(mktemp)
  cat > "$CURSOR_PROMPT_FILE" << 'PROMPT_EOF'
Generate a concise, professional git commit message based on the following changes. The commit message should:
- Be in imperative mood (e.g., 'Add feature' not 'Added feature')
- Be concise but descriptive (50-72 characters for the subject line)
- Focus on what was changed and why
- Follow conventional commit format if applicable

Changed files summary:
PROMPT_EOF
  
  echo "$DIFF_SUMMARY" >> "$CURSOR_PROMPT_FILE"
  echo "" >> "$CURSOR_PROMPT_FILE"
  
  if [ -n "$NEW_FILES" ]; then
    echo "New files: $NEW_FILES" >> "$CURSOR_PROMPT_FILE"
  fi
  if [ -n "$MODIFIED_FILES" ]; then
    echo "Modified files: $MODIFIED_FILES" >> "$CURSOR_PROMPT_FILE"
  fi
  if [ -n "$DELETED_FILES" ]; then
    echo "Deleted files: $DELETED_FILES" >> "$CURSOR_PROMPT_FILE"
  fi
  
  cat >> "$CURSOR_PROMPT_FILE" << 'PROMPT_EOF'

Git diff (first 5000 lines):
PROMPT_EOF
  
  echo "$STAGED_DIFF" >> "$CURSOR_PROMPT_FILE"
  echo "" >> "$CURSOR_PROMPT_FILE"
  echo "Return ONLY the commit message, nothing else. Do not include quotes, markdown formatting, or any other text." >> "$CURSOR_PROMPT_FILE"
  
  # Check if cursor-agent is available (check common locations)
  CURSOR_AGENT=""
  if command -v cursor-agent &> /dev/null; then
    CURSOR_AGENT="cursor-agent"
  elif [ -f "$HOME/.local/bin/cursor-agent" ]; then
    CURSOR_AGENT="$HOME/.local/bin/cursor-agent"
  elif [ -f "/usr/local/bin/cursor-agent" ]; then
    CURSOR_AGENT="/usr/local/bin/cursor-agent"
  fi
  
  if [ -n "$CURSOR_AGENT" ]; then
    echo "  Using cursor-agent to generate commit message..."
    # Try cursor-agent with --print flag for non-interactive use
    CURSOR_RESULT=$("$CURSOR_AGENT" --print "$(cat "$CURSOR_PROMPT_FILE")" 2>/dev/null || echo "")
    
    # Extract commit message from cursor-agent output
    # Remove markdown code blocks, quotes, and extra whitespace
    BACKTICK_PATTERN='```'
    COMMIT_MSG=$(echo "$CURSOR_RESULT" | \
      sed -e "s/^${BACKTICK_PATTERN}[a-z]*//" -e "s/${BACKTICK_PATTERN}\$//" \
          -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"//' -e 's/"$//' \
          -e "s/^'//" -e "s/'$//" | \
      grep -v "^${BACKTICK_PATTERN}" | \
      grep -v "^$" | \
      head -1)
    
    # Clean up any remaining markdown or formatting
    COMMIT_MSG=$(echo "$COMMIT_MSG" | sed -e 's/^\*\*//' -e 's/\*\*$//' -e 's/^#*[[:space:]]*//' -e 's/^\[.*\]\s*//')
    
    # Validate the generated message
    if [ -z "$COMMIT_MSG" ] || [ ${#COMMIT_MSG} -lt 3 ]; then
      echo -e "${YELLOW}⚠ Warning: Generated commit message is invalid, using default${NC}"
      COMMIT_MSG="Deploy: auto-commit before push"
    else
      # Truncate if too long (git commit messages should be <= 72 chars for subject)
      if [ ${#COMMIT_MSG} -gt 200 ]; then
        COMMIT_MSG=$(echo "$COMMIT_MSG" | cut -c1-200)
        echo -e "${YELLOW}⚠ Warning: Commit message truncated to 200 characters${NC}"
      fi
      echo -e "${GREEN}✓${NC} Generated commit message: $COMMIT_MSG"
    fi
  else
    echo -e "${YELLOW}⚠ Warning: cursor-agent not found, using default commit message${NC}"
    # Generate a simple commit message based on file changes
    if [ -n "$NEW_FILES" ]; then
      COMMIT_MSG="Add: $(echo "$NEW_FILES" | head -1 | xargs basename)"
    elif [ -n "$MODIFIED_FILES" ]; then
      COMMIT_MSG="Update: $(echo "$MODIFIED_FILES" | head -1 | xargs basename)"
    elif [ -n "$DELETED_FILES" ]; then
      COMMIT_MSG="Remove: $(echo "$DELETED_FILES" | head -1 | xargs basename)"
    else
      COMMIT_MSG="Deploy: auto-commit before push"
    fi
  fi
  
  # Clean up temp file
  rm -f "$CURSOR_PROMPT_FILE"
  
  # Commit changes
  if ! git commit -m "$COMMIT_MSG"; then
    echo -e "${RED}✗ Error: Failed to commit changes${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓${NC} Changes committed: $COMMIT_MSG"
  COMMITTED_CHANGES=true
  echo ""
fi

# Check if there are commits to push
CURRENT_BRANCH=$(git branch --show-current)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")

if [ -z "$UPSTREAM" ]; then
  echo -e "${YELLOW}⚠ Warning: No upstream branch set for current branch: $CURRENT_BRANCH${NC}"
  read -p "Do you want to push to origin/$CURRENT_BRANCH? (y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled by user${NC}"
    exit 0
  fi
  UPSTREAM="origin/$CURRENT_BRANCH"
fi

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse "$UPSTREAM" 2>/dev/null || echo "")
BASE=$(git merge-base @ "$UPSTREAM" 2>/dev/null || echo "")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo -e "${YELLOW}⚠ No commits to push. Local branch is up to date with $UPSTREAM${NC}"
  exit 0
elif [ "$LOCAL" = "$BASE" ]; then
  echo -e "${YELLOW}⚠ Local branch is behind $UPSTREAM. Consider pulling first.${NC}"
  read -p "Do you want to continue anyway? (y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled by user${NC}"
    exit 0
  fi
fi

echo -e "${GREEN}✓${NC} Git status OK"
echo "  Current branch: $CURRENT_BRANCH"
echo "  Upstream: $UPSTREAM"
echo ""

# Step 4: Push to origin
echo -e "${GREEN}Step 4:${NC} Pushing to origin..."
if ! git push origin "$CURRENT_BRANCH"; then
  echo -e "${RED}✗ Error: Git push failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Successfully pushed to origin/$CURRENT_BRANCH"
echo ""

# Step 5: Release task operator lock (if cursor-agents is available)
# Note: This step is non-critical - deployment succeeds even if lock release fails
# Test deploy to observe lock release attempt
echo -e "${GREEN}Step 5:${NC} Releasing task operator lock..."
CURSOR_AGENTS_URL="${CURSOR_AGENTS_URL:-http://cursor-agents:3002}"
CLEAR_LOCK_SCRIPT="${CLEAR_LOCK_SCRIPT:-/cursor/tools/cursor-agents/clear_task_operator_lock.py}"

# Temporarily disable exit on error for this step (non-critical)
set +e

# Try to use the Python script if available (in Docker environment)
if [ -f "$CLEAR_LOCK_SCRIPT" ]; then
  if python3 "$CLEAR_LOCK_SCRIPT" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Task operator lock released"
  else
    echo -e "${YELLOW}⚠${NC} Failed to release task operator lock via Python script (non-critical)"
  fi
else
  # Fallback: Try direct API call using curl
  if command -v curl &> /dev/null; then
    LOCK_RESULT=$(curl -s -X DELETE "${CURSOR_AGENTS_URL}/task-operator/lock" 2>/dev/null)
    if echo "$LOCK_RESULT" | grep -q '"success":true'; then
      echo -e "${GREEN}✓${NC} Task operator lock released via API"
    else
      echo -e "${YELLOW}⚠${NC} Failed to release task operator lock via API (non-critical)"
      if [ -n "$LOCK_RESULT" ]; then
        echo "  Response: $LOCK_RESULT" | head -3
      fi
    fi
  else
    echo -e "${YELLOW}⚠${NC} Cannot release task operator lock: curl not available (non-critical)"
  fi
fi

# Re-enable exit on error for remaining steps
set -e
echo ""

echo "=========================================="
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✓ Linting passed (all files)"
echo "  ✓ Code formatting OK (all files)"
echo "  ✓ All tests passed"
echo "  ✓ Coverage generated"
if [ "$COMMITTED_CHANGES" = "true" ]; then
  echo "  ✓ Changes committed"
fi
echo "  ✓ Pushed to origin/$CURRENT_BRANCH"
echo ""

