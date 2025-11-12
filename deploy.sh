#!/bin/bash

# Deploy Script
# This script runs CI tests and then pushes to origin
# Use this to deploy changes after verifying they pass all tests

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

# Step 2: Run CI tests
echo -e "${GREEN}Step 2:${NC} Running CI tests..."
if ! ./test-ci.sh; then
  echo -e "${RED}✗ Error: CI tests failed. Deployment aborted.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} All CI tests passed"
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
  
  # Generate commit message using cursor-cli
  echo ""
  echo -e "${GREEN}Step 3.6:${NC} Generating commit message with cursor-cli..."
  
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
  
  # Build prompt for cursor-cli using heredoc to safely handle special characters
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
  
  # Check if cursor-cli is available
  if command -v cursor &> /dev/null; then
    echo "  Using cursor-cli to generate commit message..."
    CURSOR_RESULT=$(cursor --prompt "$(cat "$CURSOR_PROMPT_FILE")" 2>/dev/null || echo "")
    
    # Extract commit message from cursor output
    # Remove markdown code blocks, quotes, and extra whitespace
    # Use printf to avoid backtick interpretation issues
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
    COMMIT_MSG=$(echo "$COMMIT_MSG" | sed -e 's/^\*\*//' -e 's/\*\*$//' -e 's/^#*[[:space:]]*//')
    
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
    echo -e "${YELLOW}⚠ Warning: cursor-cli not found, using default commit message${NC}"
    COMMIT_MSG="Deploy: auto-commit before push"
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

echo "=========================================="
echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✓ CI tests passed"
if [ "$COMMITTED_CHANGES" = "true" ]; then
  echo "  ✓ Changes committed"
fi
echo "  ✓ Pushed to origin/$CURRENT_BRANCH"
echo ""

