# cursor-runner Troubleshooting Guide

This guide covers common issues and solutions for the cursor-runner application.

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Runtime Errors](#runtime-errors)
- [Git Service Issues](#git-service-issues)
- [Cursor CLI Issues](#cursor-cli-issues)
- [Network & API Issues](#network--api-issues)
- [Testing Issues](#testing-issues)
- [Development Workflow](#development-workflow)
- [Docker Issues](#docker-issues)
- [Logging & Debugging](#logging--debugging)

---

## Installation & Setup

### Issue: "Cannot find module" errors

**Problem**: Dependencies not installed or Node.js version mismatch.

**Solution**:
```bash
# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Verify Node.js version (requires 18+)
node --version

# If using nvm, ensure correct version
nvm use 18
```

### Issue: "package-lock.json not found" during Docker build

**Problem**: `package-lock.json` is missing or not committed to git.

**Solution**:
```bash
# Generate package-lock.json
npm install

# Verify it exists
ls -la package-lock.json

# Commit to git (should NOT be in .gitignore)
git add package-lock.json
git commit -m "Add package-lock.json"
```

### Issue: Environment variables not loading

**Problem**: `.env` file missing or not in correct location.

**Solution**:
```bash
# Check if .env exists
ls -la .env

# Create from example if missing
cp .env.example .env

# Verify environment variables are loaded
node -e "require('dotenv').config(); console.log(process.env.PORT)"
```

### Issue: Port 3001 already in use

**Problem**: Another service is using port 3001.

**Solution**:
```bash
# Find what's using the port
lsof -i :3001
# or
netstat -an | grep 3001

# Kill the process or change PORT in .env
export PORT=3002
npm start
```

---

## Runtime Errors

### Issue: "cursor-cli not available" error

**Problem**: cursor-cli is not installed or not in PATH.

**Solution**:
```bash
# Check if cursor-cli is installed
which cursor
cursor --version

# If not found, install cursor-cli
# (Follow cursor-cli installation instructions)

# Verify PATH includes cursor-cli location
echo $PATH

# Or set CURSOR_CLI_PATH in .env
CURSOR_CLI_PATH=/path/to/cursor
```

### Issue: Server fails to start

**Problem**: Missing dependencies, configuration errors, or port conflicts.

**Solution**:
```bash
# Check logs
tail -f logs/cursor-runner.log
tail -f logs/exceptions.log

# Verify all dependencies installed
npm ci

# Check configuration
node -e "require('dotenv').config(); console.log(require('./src/index.js'))"

# Test server startup manually
node src/index.js
```

### Issue: "Repository not found locally" error

**Problem**: Repository hasn't been cloned yet.

**Solution**:
```bash
# Clone the repository first
curl -X POST http://localhost:3001/git/clone \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl": "https://github.com/user/repo.git"}'

# Or check existing repositories
curl http://localhost:3001/git/repositories
```

### Issue: Command timeout errors

**Problem**: Commands taking longer than configured timeout.

**Solution**:
```bash
# Increase timeout in .env
CURSOR_CLI_TIMEOUT=600000  # 10 minutes
TERMINAL_COMMAND_TIMEOUT=600000

# Restart server
npm start
```

---

## Git Service Issues

### Issue: "Repository already exists" error

**Problem**: Trying to clone a repository that's already cloned.

**Solution**:
```bash
# List existing repositories
curl http://localhost:3001/git/repositories

# Remove existing repository if needed
rm -rf repositories/repo-name

# Or use a different repository name
curl -X POST http://localhost:3001/git/clone \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl": "https://github.com/user/repo.git", "repositoryName": "new-name"}'
```

### Issue: "Branch not found" error

**Problem**: Branch doesn't exist in the repository.

**Solution**:
```bash
# Check available branches
cd repositories/repo-name
git branch -a

# Create branch if needed
git checkout -b new-branch

# Or checkout existing branch
curl -X POST http://localhost:3001/git/checkout \
  -H "Content-Type: application/json" \
  -d '{"repository": "repo-name", "branch": "main"}'
```

### Issue: Git command fails with permission errors

**Problem**: SSH keys not configured or repository access denied.

**Solution**:
```bash
# Verify SSH key is set up
ssh -T git@github.com

# For HTTPS, ensure credentials are configured
git config --global credential.helper store

# Check repository permissions
# Ensure you have access to the repository
```

### Issue: "Invalid repository URL" error

**Problem**: Repository URL format is incorrect.

**Solution**:
```bash
# Valid URL formats:
# HTTPS: https://github.com/user/repo.git
# SSH: git@github.com:user/repo.git
# Short: user/repo (assumes GitHub)

# Verify URL format
curl -X POST http://localhost:3001/git/clone \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl": "https://github.com/user/repo.git"}'
```

---

## Cursor CLI Issues

### Issue: "Command timeout" errors

**Problem**: cursor-cli commands taking too long.

**Solution**:
```bash
# Increase timeout
export CURSOR_CLI_TIMEOUT=600000

# Check if cursor-cli is responsive
cursor --version

# Test command manually
cursor generate --prompt "test"
```

### Issue: "Blocked command detected" error

**Problem**: Command is in the blocked commands list.

**Solution**:
```bash
# Check blocked commands in .env
BLOCKED_TERMINAL_COMMANDS=rm,del,format,dd,sudo,su

# Remove from blocked list if needed (not recommended for security)
# Or use an allowed command instead
```

### Issue: "Output size exceeded limit" error

**Problem**: Command output is too large.

**Solution**:
```bash
# Increase output size limit
export TERMINAL_MAX_OUTPUT_SIZE=20971520  # 20MB

# Or break command into smaller parts
```

### Issue: cursor-cli not generating expected output

**Problem**: cursor-cli configuration or prompt issues.

**Solution**:
```bash
# Test cursor-cli directly
cursor generate --prompt "Create a simple hello world function"

# Check cursor-cli logs
# (cursor-cli may have its own logging)

# Verify cursor-cli version
cursor --version
```

---

## Network & API Issues

### Issue: "Connection refused" to jarek-va

**Problem**: jarek-va service is not running or URL is incorrect.

**Solution**:
```bash
# Check jarek-va is running
curl http://localhost:3000/health

# Verify JAREK_VA_URL in .env
JAREK_VA_URL=http://localhost:3000

# If using Docker, use service name
JAREK_VA_URL=http://app:3000

# Check network connectivity
ping localhost  # or ping app (if Docker)
```

### Issue: API requests timing out

**Problem**: Network latency or service overload.

**Solution**:
```bash
# Increase timeout values
export CURSOR_CLI_TIMEOUT=600000
export TERMINAL_COMMAND_TIMEOUT=600000

# Check service health
curl http://localhost:3001/health

# Check logs for errors
tail -f logs/cursor-runner.log
```

### Issue: CORS errors in browser

**Problem**: CORS not configured for browser requests.

**Solution**:
```bash
# Add CORS middleware in server.js if needed
# (Currently API is meant for server-to-server communication)

# Use server-side requests instead of browser
# Or configure CORS in Express app
```

### Issue: "Network virtual-assistant-network not found"

**Problem**: Docker network doesn't exist.

**Solution**:
```bash
# Create the network
docker network create virtual-assistant-network

# Or use the create script
./create-network.sh

# Verify network exists
docker network ls | grep virtual-assistant-network
```

---

## Testing Issues

### Issue: Tests fail with "ExperimentalWarning: VM Modules"

**Problem**: Jest using experimental VM modules feature.

**Solution**:
```bash
# This is expected and non-blocking
# Tests should still pass

# If tests fail, check Node.js version
node --version  # Should be 18+

# Run tests with explicit NODE_OPTIONS
NODE_OPTIONS=--experimental-vm-modules npm test
```

### Issue: "Cannot find module" in tests

**Problem**: Test dependencies not installed or path issues.

**Solution**:
```bash
# Reinstall dependencies
npm ci

# Check test file imports use .js extension
# ES modules require explicit .js extensions

# Verify jest.config.js is correct
cat jest.config.js
```

### Issue: Tests timeout

**Problem**: Tests taking too long to complete.

**Solution**:
```bash
# Increase Jest timeout
# In jest.config.js:
testTimeout: 30000  # 30 seconds

# Or for specific test:
jest.setTimeout(30000);
```

### Issue: Linter errors in tests

**Problem**: ESLint rules for test files.

**Solution**:
```bash
# Run linter
npm run lint

# Auto-fix issues
npm run lint:fix

# Check .eslintrc.json for test file rules
```

---

## Development Workflow

### Issue: "npm run lint" fails

**Problem**: Code doesn't meet ESLint rules.

**Solution**:
```bash
# See linting errors
npm run lint

# Auto-fix what can be fixed
npm run lint:fix

# Manually fix remaining issues
# Check .eslintrc.json for rules
```

### Issue: "npm run format:check" fails

**Problem**: Code formatting doesn't match Prettier rules.

**Solution**:
```bash
# Check formatting
npm run format:check

# Auto-format code
npm run format

# Verify formatting
npm run format:check
```

### Issue: Git workflow fails

**Problem**: GitHub Actions or deployment issues.

**Solution**:
```bash
# Check workflow files
cat .github/workflows/test.yml
cat .github/workflows/deploy.yml

# Test locally first
npm test
npm run lint
npm run format:check

# Verify all changes committed
git status
```

### Issue: Coverage reports not generating

**Problem**: Jest coverage configuration issue.

**Solution**:
```bash
# Run coverage
npm run test:coverage

# Check coverage directory
ls -la coverage/

# Verify lcov.info exists
ls -la coverage/lcov.info

# Check jest.config.js coverage settings
```

---

## Docker Issues

For detailed Docker troubleshooting, see [DOCKER_TROUBLESHOOTING.md](./DOCKER_TROUBLESHOOTING.md).

### Quick Docker Fixes

```bash
# Start Docker/Colima
colima start

# Validate Docker setup
./validate-docker.sh

# Build Docker image
docker compose build cursor-runner

# Check Docker logs
docker compose logs cursor-runner

# Restart container
docker compose restart cursor-runner
```

---

## Logging & Debugging

### Viewing Logs

```bash
# Application logs
tail -f logs/cursor-runner.log

# Exception logs
tail -f logs/exceptions.log

# Rejection logs
tail -f logs/rejections.log

# All logs
tail -f logs/*.log
```

### Enabling Debug Logging

```bash
# Set log level in .env
LOG_LEVEL=debug

# Or at runtime
export LOG_LEVEL=debug
npm start
```

### Common Log Messages

**"Failed to clone repository"**
- Check repository URL format
- Verify repository exists and is accessible
- Check network connectivity

**"Command timeout"**
- Increase timeout values
- Check if command is actually running
- Verify cursor-cli is responsive

**"Repository not found"**
- Clone repository first using POST /git/clone
- Check repositories directory exists
- Verify repository name is correct

**"Branch not found"**
- List branches: `git branch -a` in repository
- Create branch if needed
- Check branch name spelling

### Debugging Tips

1. **Enable verbose logging**: Set `LOG_LEVEL=debug` in `.env`
2. **Check environment variables**: `node -e "require('dotenv').config(); console.log(process.env)"`
3. **Test endpoints manually**: Use `curl` to test API endpoints
4. **Verify services**: Check all dependent services are running
5. **Check file permissions**: Ensure logs and repositories directories are writable

### Getting Help

1. Check this troubleshooting guide
2. Review [DEVELOPMENT.md](./DEVELOPMENT.md) for development setup
3. Check [DOCKER_TROUBLESHOOTING.md](./DOCKER_TROUBLESHOOTING.md) for Docker issues
4. Review application logs in `logs/` directory
5. Check GitHub Issues for similar problems

---

## Quick Reference

### Common Commands

```bash
# Start server
npm start

# Run tests
npm test

# Run linter
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check

# Generate coverage
npm run test:coverage

# Validate Docker
./validate-docker.sh

# Check health
curl http://localhost:3001/health
```

### Environment Variables

```bash
# Server
PORT=3001

# Cursor CLI
CURSOR_CLI_PATH=cursor
CURSOR_CLI_TIMEOUT=300000

# Git
REPOSITORIES_PATH=./repositories
GIT_COMMAND_TIMEOUT=60000

# Terminal
TERMINAL_COMMAND_TIMEOUT=300000
TERMINAL_MAX_OUTPUT_SIZE=10485760

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### File Locations

- **Logs**: `logs/cursor-runner.log`
- **Repositories**: `repositories/`
- **Configuration**: `.env`
- **Source**: `src/`
- **Tests**: `tests/`

---

## Still Having Issues?

1. **Check the logs**: Most issues are logged with details
2. **Verify configuration**: Ensure all environment variables are set correctly
3. **Test components individually**: Test cursor-cli, git, and network separately
4. **Review recent changes**: Check git history for recent modifications
5. **Check dependencies**: Ensure all npm packages are up to date

For Docker-specific issues, see [DOCKER_TROUBLESHOOTING.md](./DOCKER_TROUBLESHOOTING.md).

