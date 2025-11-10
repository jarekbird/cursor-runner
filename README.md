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
- cursor-cli installed and available in PATH
- Target application (e.g., jarek-va) accessible

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
```

## Configuration

Edit `.env` file with your settings:

```env
# Cursor CLI Configuration
CURSOR_CLI_PATH=cursor
CURSOR_CLI_TIMEOUT=300000

# Target Application
TARGET_APP_PATH=../jarek-va
TARGET_APP_TYPE=rails

# jarek-va Communication
JAREK_VA_URL=http://localhost:3000
JAREK_VA_API_KEY=your-api-key-here
```

## Usage

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

### As CLI

```bash
npm start
```

## Development

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

See `DEVELOPMENT.md` for detailed integration patterns.

## License

ISC

