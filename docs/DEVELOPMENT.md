# cursor-runner Development Guide

## Development Environment Setup

### Node.js Version

Use Node.js 18+ as specified in `.nvmrc`:

```bash
# If using nvm
nvm use

# Verify version
node --version
```

### Install Dependencies

```bash
npm install
```

## Project Structure

```
cursor-runner/
├── src/
│   ├── index.js          # Main entry point
│   ├── cursor-cli.js     # cursor-cli wrapper
│   ├── target-app.js     # Target application runner
│   └── logger.js         # Logging configuration
├── tests/
│   ├── cursor-cli.test.js
│   ├── target-app.test.js
│   └── helpers/
│       └── test-helpers.js
├── package.json
├── jest.config.js
├── .eslintrc.json
├── .prettierrc.json
└── README.md
```

## Code Organization

### Main Modules

1. **index.js**: Main application entry point
   - Initializes cursor-runner
   - Handles code generation workflow orchestration
   - Exports CursorRunner class

2. **cursor-cli.js**: cursor-cli Integration
   - Wraps cursor-cli command execution
   - Handles security validation
   - Manages timeouts and output limits
   - Supports TDD phases (red, green, refactor)

3. **target-app.js**: Target Application Runner
   - Runs tests in target applications
   - Supports multiple app types (Rails, Node.js)
   - Extracts test results

4. **logger.js**: Logging Configuration
   - Winston-based logging
   - Console and file output
   - Error handling

## cursor-cli Integration Patterns

### Basic Command Execution

```javascript
import { CursorCLI } from './src/cursor-cli.js';

const cursor = new CursorCLI();
await cursor.validate(); // Ensure cursor-cli is available

const result = await cursor.executeCommand(['generate', '--prompt', 'Create user service']);
```

### TDD Workflow

```javascript
// Red phase: Generate tests
const testResult = await cursor.generateTests(requirements, targetPath);

// Green phase: Generate implementation
const implResult = await cursor.generateImplementation(requirements, targetPath);

// Refactor phase: Refactor code
const refactorResult = await cursor.refactorCode(requirements, targetPath);
```

### Security Considerations

- Commands are validated against whitelist/blacklist
- Timeouts prevent hanging processes
- Output size limits prevent memory exhaustion
- Path validation ensures safe execution

## Communication with jarek-va

### Request Format

jarek-va sends HTTP requests to cursor-runner:

```json
{
  "id": "request-123",
  "phase": "red",
  "requirements": {
    "description": "Create user service",
    "type": "service",
    "test_framework": "rspec"
  },
  "targetPath": "../jarek-va"
}
```

### Response Format

cursor-runner returns results:

```json
{
  "success": true,
  "phase": "red",
  "output": "Generated test files...",
  "files": [
    "spec/services/user_service_spec.rb"
  ]
}
```

### Error Handling

Errors are returned in response:

```json
{
  "success": false,
  "phase": "red",
  "error": "Command timeout after 300000ms"
}
```

## Testing

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Writing Tests

Tests use Jest. Example:

```javascript
import { CursorCLI } from '../src/cursor-cli.js';

describe('CursorCLI', () => {
  it('should validate cursor-cli', async () => {
    const cursor = new CursorCLI();
    await expect(cursor.validate()).resolves.toBe(true);
  });
});
```

## Code Quality

### Linting

```bash
npm run lint
npm run lint:fix
```

Uses ESLint with Prettier integration.

### Formatting

```bash
npm run format
npm run format:check
```

Uses Prettier for consistent code formatting.

## Environment Variables

Key environment variables:

- `CURSOR_CLI_PATH`: Path to cursor-cli executable
- `CURSOR_CLI_TIMEOUT`: Command timeout in milliseconds
- `TARGET_APP_PATH`: Path to target application
- `TARGET_APP_TYPE`: Type of target app (rails, node)
- `JAREK_VA_URL`: jarek-va API URL
- `JAREK_VA_API_KEY`: API key for jarek-va
- `LOG_LEVEL`: Logging level (info, debug, error)
- `LOG_FILE`: Log file path

## Logging

Logs are written to:
- Console (with colors)
- File: `logs/cursor-runner.log`
- Exceptions: `logs/exceptions.log`
- Rejections: `logs/rejections.log`

Log levels: `error`, `warn`, `info`, `debug`

## Troubleshooting

### cursor-cli not found

Ensure cursor-cli is installed and in PATH:

```bash
which cursor
cursor --version
```

### Target application not found

Check `TARGET_APP_PATH` in `.env`:

```bash
ls -la $TARGET_APP_PATH
```

### Command timeouts

Increase `CURSOR_CLI_TIMEOUT` in `.env` for long-running commands.

### Test failures

Check target application is properly configured:

```bash
cd $TARGET_APP_PATH
bundle install  # For Rails
npm install     # For Node.js
```

## Next Steps

1. Implement HTTP API server for jarek-va communication
2. Add more robust error handling
3. Enhance test result extraction
4. Add support for more target application types
5. Implement request queuing for concurrent requests

