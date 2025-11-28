# cursor-runner

Node.js application for cursor-cli execution and code generation workflows. Integrates with jarek-va (Ruby on Rails orchestration layer) for code writing tool requests.

## Overview

cursor-runner is responsible for:
- Executing cursor-cli commands to implement code changes
- Running target applications being developed by cursor
- Handling code generation and testing workflows
- Managing TDD cycles (Red → Green → Refactor)
- Integrating with jarek-va for code writing tool requests

## Architecture

```
jarek-va (Rails) → cursor-runner (Node.js) → cursor-cli → Target Application
```

1. **jarek-va** receives code writing tool requests from ElevenLabs Agent
2. **jarek-va** sends code generation request to **cursor-runner**
3. **cursor-runner** executes cursor-cli commands to generate code
4. **cursor-runner** runs tests in target application
5. **cursor-runner** returns results to **jarek-va**

## Prerequisites

- Node.js 18+ (use nvm with `.nvmrc`)
- npm dependencies installed (`npm install`)
- cursor-cli installed and available in PATH
- Target application (e.g., jarek-va) accessible
- **NO Ruby or bundle required** - This is a Node.js project that uses npm commands exclusively

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
```

### Gmail MCP Server Installation

The Gmail MCP server is automatically installed as a dev dependency when you run `npm install`. 

**Local Development**:
- Gmail MCP server is installed via `package.json` devDependencies
- Verify installation: `npm run mcp:gmail:version`
- Or use verification script: `./scripts/check-gmail-mcp.sh`

**Docker**:
- Gmail MCP server is automatically installed during Docker image build
- No additional steps required
- Verify in container: `docker run --rm cursor-runner mcp-server-gmail --version`

**Troubleshooting**:
- If `mcp-server-gmail` command not found, ensure `npm install` completed successfully
- Check that `@modelcontextprotocol/server-gmail` is in `package.json` devDependencies
- In Docker, verify the package is installed in the Dockerfile

### Gmail MCP Smoke Test

An optional smoke test is available to verify Gmail MCP configuration and connectivity.

**⚠️ IMPORTANT**: This test is opt-in and should NOT run in CI by default. It requires a real Gmail account.

**Usage**:
```bash
# Run smoke test
ENABLE_GMAIL_SMOKE_TEST=1 npm run test:gmail:smoke

# Or directly
ENABLE_GMAIL_SMOKE_TEST=1 tsx scripts/gmail_smoke_test.ts
```

**What it tests**:
- Gmail MCP feature flag is enabled
- Gmail configuration is complete
- Gmail MCP server is available
- MCP configuration includes Gmail entry

**Requirements**:
- `ENABLE_GMAIL_MCP=true` must be set
- Gmail credentials must be configured (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`)
- Gmail MCP server must be installed

**Note**: This test performs read-only operations and is safe to run against a test Gmail account.

## Configuration

Edit `.env` file with your settings:

```env
# HTTP Server Configuration
PORT=3001

# Cursor CLI Configuration
CURSOR_CLI_PATH=cursor
CURSOR_CLI_TIMEOUT=300000
CURSOR_API_KEY=your-cursor-api-key-here

# Target Application
TARGET_APP_PATH=../jarek-va
TARGET_APP_TYPE=rails

# Git Service Configuration
REPOSITORIES_PATH=./repositories
GIT_COMMAND_TIMEOUT=60000

# Terminal Service Configuration
TERMINAL_COMMAND_TIMEOUT=300000
TERMINAL_MAX_OUTPUT_SIZE=10485760

# jarek-va Communication
JAREK_VA_URL=http://localhost:3000
JAREK_VA_API_KEY=your-api-key-here
```

## Usage

### Start HTTP Server

```bash
npm start
```

The server will start on port 3001 (configurable via `PORT` environment variable).

### API Endpoints

#### Health Check
```
GET /health
```
Returns server health status.

#### Git Operations

**Clone Repository**
```
POST /git/clone
Content-Type: application/json

{
  "repositoryUrl": "https://github.com/user/repo.git",
  "repositoryName": "optional-name"
}
```

**List Repositories**
```
GET /git/repositories
```
Returns list of locally cloned repositories in `/repositories` folder.

**Checkout Branch**
```
POST /git/checkout
Content-Type: application/json

{
  "repository": "repo-name",
  "branch": "branch-name"
}
```

**Push Branch**
```
POST /git/push
Content-Type: application/json

{
  "repository": "repo-name",
  "branch": "branch-name"
}
```

**Pull Branch**
```
POST /git/pull
Content-Type: application/json

{
  "repository": "repo-name",
  "branch": "branch-name"
}
```

### As a Module

```javascript
import { CursorRunner } from './src/index.js';

const runner = new CursorRunner();
await runner.initialize();

const result = await runner.executeCodeGeneration({
  id: 'req-123',
  phase: 'red',
  requirements: { description: 'Create user service' },
  targetPath: '../jarek-va',
});
```

## Development

### Deployment

The `deploy.sh` script runs all CI checks and pushes to origin:

```bash
./deploy.sh
```

**Prerequisites for deploy.sh:**
- Node.js 18+ and npm dependencies installed
- Git repository initialized
- **NO Ruby or bundle required** - This script uses npm commands exclusively (`npm run lint`, `npm test`, `npm run test:coverage`, etc.)

The deploy script will:
1. Run linting (`npm run lint`)
2. Check code formatting (`npm run format:check`)
3. Run all tests (`npm test`)
4. Generate test coverage (`npm run test:coverage`)
5. Commit any uncommitted changes (if present)
6. Push to origin

**Note**: This is different from `jarek-va/scripts/deploy.sh`, which is a Ruby on Rails project that requires Ruby and bundle.

### Running CI Tests (Required Before Committing)

**IMPORTANT**: Before considering changes complete, run all CI test steps:

```bash
# Run all CI test workflow steps (REQUIRED)
npm run ci
# or
./test-ci.sh
```

This runs all steps from the GitHub Actions test workflow:
- ✅ Node.js version check
- ✅ Install dependencies (`npm ci`)
- ✅ **Detect changed files** (optimization: only tests changed files)
- ✅ Run linter (on changed files if detected, otherwise all files)
- ✅ Check code formatting (on changed files if detected, otherwise all files)
- ✅ Run Jest tests (on changed files if detected, otherwise all files)
- ✅ Generate test coverage (on changed files if detected, otherwise all files)
- ✅ Verify coverage files exist

**All steps must pass before committing changes.**

**Note**: The CI workflow automatically detects changed files and only runs tests/linting on those files. This speeds up the workflow significantly when only a few files are modified. If no changes are detected or if the detection fails, it falls back to running all tests.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Linting and Formatting

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

## TDD Workflow

cursor-runner supports the TDD (Test-Driven Development) workflow:

1. **Red Phase**: Generate tests first
   ```javascript
   await runner.executeCodeGeneration({
     phase: 'red',
     requirements: { /* test requirements */ },
   });
   ```

2. **Green Phase**: Generate implementation to pass tests
   ```javascript
   await runner.executeCodeGeneration({
     phase: 'green',
     requirements: { /* implementation requirements */ },
   });
   ```

3. **Refactor Phase**: Refactor code while keeping tests green
   ```javascript
   await runner.executeCodeGeneration({
     phase: 'refactor',
     requirements: { /* refactoring requirements */ },
   });
   ```

4. **Validate Phase**: Run tests to ensure everything passes
   ```javascript
   await runner.executeCodeGeneration({
     phase: 'validate',
   });
   ```

## Security

cursor-runner includes security features:

- **Command Whitelisting**: Only allowed commands can be executed
- **Command Blacklisting**: Dangerous commands are blocked
- **Timeout Protection**: Commands are killed after timeout
- **Output Size Limits**: Prevents memory exhaustion
- **Path Validation**: Validates target application paths

## Integration with jarek-va

cursor-runner communicates with jarek-va via HTTP API. jarek-va sends code generation requests to cursor-runner, which executes cursor-cli commands and returns results.

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed integration patterns.

## Docker / Production

For Docker setup and production deployment instructions, see [DOCKER.md](docs/DOCKER.md).

## Troubleshooting

If you encounter issues, check the [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) guide for common problems and solutions.

Common issues:
- **Installation problems**: See [Installation & Setup](docs/TROUBLESHOOTING.md#installation--setup)
- **Runtime errors**: Check logs in `logs/` directory
- **Docker issues**: See [DOCKER_TROUBLESHOOTING.md](docs/DOCKER_TROUBLESHOOTING.md)
- **Git service errors**: See [Git Service Issues](docs/TROUBLESHOOTING.md#git-service-issues)
- **Cursor CLI problems**: See [Cursor CLI Issues](docs/TROUBLESHOOTING.md#cursor-cli-issues)

## License

ISC

