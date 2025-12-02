# cursor-runner Testing Implementation Execution Order

This document breaks down the testing master plan into granular, actionable steps that can be implemented iteratively with automated tests. Each step includes what to implement, what tests to write, and verification criteria.

## Phase 1: Foundation & Test Infrastructure

### Step 1.1: Enhance Test Utilities & Helpers
**Objective**: Create reusable test infrastructure for mocking and setup.

**Tasks**:
1. Extend `tests/test-utils.ts`:
   - Add `createMockRedisClient()` that returns a mock `ioredis` instance with basic operations (get, set, setex, smembers, etc.)
   - Add `createTempSqliteDb()` that creates a temporary SQLite file, runs migrations, and returns a cleanup function
   - Add `createMockCursorCLI()` that returns a fully mocked `CursorCLI` with all methods
   - Add `createMockServer()` helper that creates a `Server` instance with injected mocks
   - Add `assertErrorResponse()` helper for validating error response shapes
   - Add `assertSuccessResponse()` helper for validating success response shapes

**Tests**:
- Write unit tests for each helper function to ensure they work correctly
- Verify mock Redis client can simulate connection failures
- Verify temp SQLite DB can be created, migrated, and cleaned up

**Verification**:
- All helper functions have basic unit tests
- Helpers can be imported and used in other test files
- No linting errors

---

### Step 1.2: Test Configuration & Coverage Setup
**Objective**: Ensure Jest configuration supports all test types and coverage reporting.

**Tasks**:
1. Review and update `jest.config.js`:
   - Ensure `collectCoverageFrom` includes all `src/**/*.ts` files (excluding `index.ts` for now)
   - Add coverage thresholds (start conservative: `lines: 60, branches: 50, functions: 60, statements: 60`)
   - Verify `testMatch` pattern matches all test files
   - Add `testTimeout` if needed (default 5000ms may be too short for some integration tests)

2. Add npm scripts to `package.json`:
   - `test:unit` - runs only unit tests (fast, no external dependencies)
   - `test:integration` - runs integration tests (may use temp files/DBs)
   - `test:e2e` - runs E2E-lite tests
   - `test:all` - runs all tests
   - `test:watch` - watch mode for development

**Tests**:
- Run `npm test` and verify all existing tests pass
- Verify coverage report is generated
- Verify test scripts work correctly

**Verification**:
- All existing tests pass
- Coverage report generates successfully
- Test scripts execute without errors

---

## Phase 2: Core Application Lifecycle

### Step 2.1: CursorRunner Constructor & Config Validation
**Objective**: Test basic initialization and configuration validation.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `constructor` with all dependencies injected
   - Add test: `validateConfig` throws when `CURSOR_CLI_PATH` is missing
   - Add test: `validateConfig` succeeds when `CURSOR_CLI_PATH` is set
   - Add test: `validateConfig` handles multiple missing env vars

**Tests**:
- Write tests in `tests/index.test.ts` using existing patterns
- Use `beforeEach` to set/clear env vars
- Verify error messages are descriptive

**Verification**:
- All new tests pass
- Error messages are clear and actionable
- No regressions in existing tests

---

### Step 2.2: CursorRunner.initialize() - Happy Path
**Objective**: Test successful initialization flow.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `initialize()` calls all dependencies in correct order:
     - `validateConfig()` (implicit)
     - `ensureSchemaMigrationsTable()` and `runMigrations()`
     - `GitHubAuthService.initialize()`
     - `verifyMcpConfig()`
     - `validateGmailConfig()`
     - `cursorCLI.validate()`
     - `server.start()`
   - Mock all dependencies and verify call order
   - Verify startup log messages are emitted

**Tests**:
- Create mocks for: migrations, `GitHubAuthService`, `cursorCLI`, `server`
- Use `jest.spyOn` or dependency injection to track calls
- Assert logs contain expected startup info

**Verification**:
- Test passes and verifies correct initialization sequence
- Logs are captured and validated
- All mocks are properly cleaned up

---

### Step 2.3: CursorRunner.initialize() - Migration Failure Handling
**Objective**: Ensure migrations failures don't block startup.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `initialize()` continues when migrations throw
   - Mock `runMigrations()` to throw an error
   - Verify error is logged with warning message
   - Verify startup continues and `server.start()` is still called
   - Verify log contains "Continuing startup despite migration failure"

**Tests**:
- Mock `runMigrations` to throw
- Capture logger calls to verify warning is logged
- Verify `server.start()` is still called

**Verification**:
- Test passes and confirms graceful degradation
- Warning is logged appropriately
- Server still starts successfully

---

### Step 2.4: CursorRunner.initialize() - Critical Failure Handling
**Objective**: Ensure critical failures cause startup to fail.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `initialize()` fails when `GitHubAuthService.initialize()` throws
   - Add test: `initialize()` fails when `cursorCLI.validate()` throws
   - Verify errors are propagated and startup does not complete
   - Verify `server.start()` is NOT called on critical failures

**Tests**:
- Mock critical dependencies to throw
- Verify `initialize()` rejects with appropriate error
- Verify `server.start()` is never called

**Verification**:
- Tests pass and confirm fail-fast behavior
- Error messages are clear
- No resource leaks (server not started)

---

### Step 2.5: CursorRunner.initialize() - MCP Config Verification
**Objective**: Test MCP configuration checking and logging.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `verifyMcpConfig()` logs warning when `/root/.cursor/mcp.json` is missing
   - Add test: `verifyMcpConfig()` logs info when MCP config exists
   - Add test: `verifyMcpConfig()` logs warning when cursor-agents MCP server is missing
   - Add test: `verifyMcpConfig()` logs info when cursor-agents MCP server exists
   - Mock `fs.existsSync` to simulate different file states

**Tests**:
- Use `jest.mock('fs')` to control file existence
- Verify appropriate log levels (warn vs info)
- Verify log messages contain helpful suggestions

**Verification**:
- Tests pass and verify correct logging behavior
- Log messages are informative
- No false positives or negatives

---

### Step 2.6: CursorRunner.shutdown()
**Objective**: Test graceful shutdown behavior.

**Tasks**:
1. Extend `tests/index.test.ts`:
   - Add test: `shutdown()` calls `server.stop()`
   - Add test: `shutdown()` logs memory usage
   - Add test: `shutdown()` logs call stack information
   - Add test: `shutdown()` handles errors gracefully (logs but doesn't throw)

**Tests**:
- Mock `server.stop()` and verify it's called
- Capture logger calls to verify memory usage and stack are logged
- Mock `server.stop()` to throw and verify error is logged

**Verification**:
- Tests pass and confirm shutdown is graceful
- Logs contain useful diagnostic information
- Errors don't prevent shutdown completion

---

## Phase 3: HTTP Server - Health & Diagnostics

### Step 3.1: GET /health Endpoint
**Objective**: Test basic health check endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /health` returns 200 with `{ status: 'ok', service: 'cursor-runner' }`
   - Add test: `GET /health` logs requester info (IP, user-agent)
   - Use `supertest` to make HTTP requests

**Tests**:
- Use existing `supertest` setup from `server.test.ts`
- Verify response status and body shape
- Verify logger was called with expected metadata

**Verification**:
- Test passes
- Response matches expected contract
- Logging works correctly

---

### Step 3.2: GET /health/queue Endpoint
**Objective**: Test queue status diagnostic endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /health/queue` returns queue status from `cursorCLI.getQueueStatus()`
   - Add test: `GET /health/queue` includes `warning` field when `available === 0 && waiting > 0`
   - Add test: `GET /health/queue` has no `warning` field when queue is healthy
   - Mock `cursorCLI.getQueueStatus()` to return different states

**Tests**:
- Mock `server.cursorCLI.getQueueStatus()` to return various states
- Verify response includes queue status
- Verify warning appears only when appropriate

**Verification**:
- Tests pass
- Warning logic is correct
- Response shape matches expected contract

---

## Phase 4: HTTP Server - Cursor Execution Routes

### Step 4.1: POST /cursor/execute (Synchronous)
**Objective**: Test synchronous cursor execution endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /cursor/execute` happy path - returns result from `cursorExecution.execute()`
   - Add test: `POST /cursor/execute` with `queueType` in body uses provided value
   - Add test: `POST /cursor/execute` detects `queueType` from `requestId` when `telegram-` prefix present
   - Add test: `POST /cursor/execute` returns 500 when `execute()` throws
   - Add test: `POST /cursor/execute` generates `requestId` when not provided
   - Mock `cursorExecution.execute()` to return `{ status, body }` structure

**Tests**:
- Use `supertest` to POST to `/cursor/execute`
- Mock `server.cursorExecution.execute()` with various return values
- Verify `queueType` detection logic works correctly
- Verify error handling returns appropriate status codes

**Verification**:
- All tests pass
- Queue type detection works for both explicit and implicit cases
- Error responses are properly formatted

---

### Step 4.2: POST /cursor/execute/async
**Objective**: Test asynchronous cursor execution endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /cursor/execute/async` returns 400 when `callbackUrl` is missing
   - Add test: `POST /cursor/execute/async` returns 200 immediately when valid
   - Add test: `POST /cursor/execute/async` processes execution in background
   - Add test: `POST /cursor/execute/async` sends callback on success
   - Add test: `POST /cursor/execute/async` sends error callback when execution fails
   - Add test: `POST /cursor/execute/async` logs callback errors but doesn't crash
   - Mock `cursorExecution.execute()` and `callbackWebhook()` methods

**Tests**:
- Verify immediate 200 response
- Verify background processing happens (use `setTimeout` or `waitFor` if needed)
- Mock callback webhook and verify it's called with correct payload
- Simulate callback failure and verify it's logged but doesn't throw

**Verification**:
- Tests pass
- Async behavior works correctly
- Callbacks are sent appropriately
- Error handling is robust

---

### Step 4.3: POST /cursor/iterate (Synchronous)
**Objective**: Test synchronous iteration endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /cursor/iterate` happy path - returns result from `cursorExecution.iterate()`
   - Add test: `POST /cursor/iterate` uses default `maxIterations` of 5 when not provided
   - Add test: `POST /cursor/iterate` uses provided `maxIterations` value
   - Add test: `POST /cursor/iterate` returns 500 when `iterate()` throws
   - Mock `cursorExecution.iterate()` to return `{ status, body }` structure

**Tests**:
- Similar to `/cursor/execute` tests
- Verify `maxIterations` default and override behavior
- Verify error handling

**Verification**:
- Tests pass
- Default values work correctly
- Error handling is consistent

---

### Step 4.4: POST /cursor/iterate/async
**Objective**: Test asynchronous iteration endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /cursor/iterate/async` auto-constructs `callbackUrl` when missing
   - Add test: `POST /cursor/iterate/async` logs callback URL source (env var vs default)
   - Add test: `POST /cursor/iterate/async` returns 200 immediately
   - Add test: `POST /cursor/iterate/async` processes iteration in background
   - Add test: `POST /cursor/iterate/async` sends error callback with `ErrorCallbackResponse` structure (includes `stdout`, `stderr`, `exitCode`, `iterations`, `maxIterations`)
   - Mock `buildCallbackUrl()` and `cursorExecution.iterate()`

**Tests**:
- Verify callback URL auto-construction
- Verify error callback includes all expected fields
- Verify background processing

**Verification**:
- Tests pass
- Callback URL logic works correctly
- Error callbacks have complete information

---

### Step 4.5: POST /cursor/conversation/new
**Objective**: Test force new conversation endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /cursor/conversation/new` creates new conversation with default queue type
   - Add test: `POST /cursor/conversation/new` uses provided `queueType` from body
   - Add test: `POST /cursor/conversation/new` returns conversation ID
   - Mock `cursorExecution.conversationService.forceNewConversation()`

**Tests**:
- Verify conversation creation
- Verify queue type handling
- Verify response shape

**Verification**:
- Tests pass
- Conversation creation works correctly

---

## Phase 5: HTTP Server - Conversation API

### Step 5.1: GET /api/list
**Objective**: Test conversation listing endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /api/list` returns conversations from `conversationService.listConversations()`
   - Add test: `GET /api/list` returns 500 when service throws
   - Mock `cursorExecution.conversationService.listConversations()`

**Tests**:
- Verify successful listing
- Verify error handling

**Verification**:
- Tests pass

---

### Step 5.2: POST /api/new
**Objective**: Test new conversation creation endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /api/new` creates conversation with `queueType='api'` by default
   - Add test: `POST /api/new` uses provided `queueType` from body
   - Add test: `POST /api/new` returns conversation ID
   - Mock `cursorExecution.conversationService.forceNewConversation()`

**Tests**:
- Verify default queue type
- Verify queue type override
- Verify response shape

**Verification**:
- Tests pass

---

### Step 5.3: GET /api/working-directory/files
**Objective**: Test working directory file tree endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /api/working-directory/files` returns 500 when `TARGET_APP_PATH` not set
   - Add test: `GET /api/working-directory/files` returns 404 when directory doesn't exist
   - Add test: `GET /api/working-directory/files` returns file tree when directory exists
   - Mock `process.env.TARGET_APP_PATH`, `filesystem.exists()`, and `FileTreeService.buildFileTree()`

**Tests**:
- Verify error cases
- Verify success case with mock file tree

**Verification**:
- Tests pass
- Error handling is appropriate

---

### Step 5.4: GET /api/:conversationId
**Objective**: Test get conversation endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /api/:conversationId` returns 404 when conversation not found
   - Add test: `GET /api/:conversationId` returns conversation when found
   - Add test: `GET /api/tasks` passes through to tasks router (reserved path)
   - Add test: `GET /api/agent` passes through to agent router (reserved path)
   - Add test: `GET /api/working-directory` passes through (reserved path)
   - Mock `cursorExecution.conversationService.getConversationById()`

**Tests**:
- Verify conversation retrieval
- Verify reserved paths are handled correctly
- Verify 404 handling

**Verification**:
- Tests pass
- Route conflicts are avoided

---

### Step 5.5: POST /api/:conversationId/message
**Objective**: Test send message endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /api/:conversationId/message` returns 400 when message is missing
   - Add test: `POST /api/:conversationId/message` returns 400 when message is empty string
   - Add test: `POST /api/:conversationId/message` returns 404 when conversation not found
   - Add test: `POST /api/:conversationId/message` returns 200 immediately
   - Add test: `POST /api/:conversationId/message` triggers background `cursorExecution.iterate()` with `queueType='api'`
   - Mock `cursorExecution.conversationService.getConversationById()` and `cursorExecution.iterate()`

**Tests**:
- Verify validation
- Verify async processing
- Verify queue type

**Verification**:
- Tests pass
- Validation is strict
- Background processing works

---

## Phase 6: HTTP Server - Agent Conversation API

### Step 6.1: GET /api/agent/list
**Objective**: Test agent conversation listing with pagination and sorting.

**Tasks**:
1. Create or extend `tests/agent-conversation-api.integration.test.ts`:
   - Add test: `GET /api/agent/list` returns 400 when `limit` is invalid (negative, zero, NaN)
   - Add test: `GET /api/agent/list` returns 400 when `offset` is invalid (negative, NaN)
   - Add test: `GET /api/agent/list` returns 400 when `sortBy` is invalid (not in allowed list)
   - Add test: `GET /api/agent/list` returns 400 when `sortOrder` is invalid (not 'asc' or 'desc')
   - Add test: `GET /api/agent/list` returns conversations with pagination metadata
   - Add test: `GET /api/agent/list` applies sorting correctly
   - Mock `agentConversationService.listConversations()`

**Tests**:
- Verify all validation cases
- Verify pagination metadata structure
- Verify sorting behavior

**Verification**:
- Tests pass
- Validation is comprehensive
- Pagination works correctly

---

### Step 6.2: POST /api/agent/new
**Objective**: Test agent conversation creation.

**Tasks**:
1. Extend `tests/agent-conversation-api.integration.test.ts`:
   - Add test: `POST /api/agent/new` creates conversation with optional `agentId`
   - Add test: `POST /api/agent/new` saves `metadata` when provided
   - Add test: `POST /api/agent/new` returns conversation ID
   - Mock `agentConversationService.createConversation()` and `updateConversation()`

**Tests**:
- Verify conversation creation
- Verify metadata persistence
- Verify response shape

**Verification**:
- Tests pass

---

### Step 6.3: POST /api/agent/:id/message
**Objective**: Test agent conversation message endpoint.

**Tasks**:
1. Extend `tests/agent-conversation-api.integration.test.ts`:
   - Add test: `POST /api/agent/:id/message` returns 400 when `role` is missing
   - Add test: `POST /api/agent/:id/message` returns 400 when `content` is missing
   - Add test: `POST /api/agent/:id/message` adds message and returns success
   - Add test: `POST /api/agent/:id/message` sets default `source='text'` when not provided
   - Mock `agentConversationService.addMessage()` and `getConversation()`

**Tests**:
- Verify validation
- Verify message addition
- Verify defaults

**Verification**:
- Tests pass

---

### Step 6.4: GET /api/agent/:id
**Objective**: Test get agent conversation endpoint.

**Tasks**:
1. Extend `tests/agent-conversation-api.integration.test.ts`:
   - Add test: `GET /api/agent/:id` returns 404 when conversation not found
   - Add test: `GET /api/agent/:id` returns conversation when found
   - Mock `agentConversationService.getConversation()`

**Tests**:
- Verify 404 handling
- Verify successful retrieval

**Verification**:
- Tests pass

---

## Phase 7: HTTP Server - Tasks API

### Step 7.1: Tasks API Test Infrastructure
**Objective**: Set up test infrastructure for Tasks API.

**Tasks**:
1. Create `tests/tasks-api.test.ts`:
   - Set up `beforeAll` to create temp SQLite DB and run migrations
   - Set up `afterAll` to clean up temp DB
   - Set `process.env.SHARED_DB_PATH` to temp DB path
   - Create helper to reset DB state between tests

**Tests**:
- Verify temp DB is created
- Verify migrations run successfully
- Verify cleanup works

**Verification**:
- Test infrastructure is ready
- No leaks between tests

---

### Step 7.2: GET /api/tasks
**Objective**: Test tasks listing endpoint.

**Tasks**:
1. Extend `tests/tasks-api.test.ts`:
   - Add test: `GET /api/tasks` returns all tasks when no filter
   - Add test: `GET /api/tasks?status=0` returns only ready tasks
   - Add test: `GET /api/tasks?status=1` returns only complete tasks
   - Add test: `GET /api/tasks?status=invalid` returns 400
   - Create test tasks with different statuses in `beforeEach`

**Tests**:
- Verify filtering works
- Verify validation
- Verify response includes `status_label`

**Verification**:
- Tests pass
- Filtering is accurate

---

### Step 7.3: GET /api/tasks/:id
**Objective**: Test get task endpoint.

**Tasks**:
1. Extend `tests/tasks-api.test.ts`:
   - Add test: `GET /api/tasks/:id` returns 400 when id is not numeric
   - Add test: `GET /api/tasks/:id` returns 404 when task not found
   - Add test: `GET /api/tasks/:id` returns task with `status_label` when found

**Tests**:
- Verify validation
- Verify 404 handling
- Verify response shape

**Verification**:
- Tests pass

---

### Step 7.4: POST /api/tasks
**Objective**: Test task creation endpoint.

**Tasks**:
1. Extend `tests/tasks-api.test.ts`:
   - Add test: `POST /api/tasks` returns 400 when `prompt` is missing
   - Add test: `POST /api/tasks` returns 400 when `prompt` is empty string
   - Add test: `POST /api/tasks` returns 400 when `prompt` is not a string
   - Add test: `POST /api/tasks` creates task with default `order=0` and `status=0`
   - Add test: `POST /api/tasks` creates task with provided `order` and `status`
   - Add test: `POST /api/tasks` returns 201 with created task including `status_label`

**Tests**:
- Verify all validation cases
- Verify defaults
- Verify creation

**Verification**:
- Tests pass
- Validation is strict

---

### Step 7.5: PUT /api/tasks/:id
**Objective**: Test task update endpoint.

**Tasks**:
1. Extend `tests/tasks-api.test.ts`:
   - Add test: `PUT /api/tasks/:id` returns 400 when id is not numeric
   - Add test: `PUT /api/tasks/:id` returns 400 when `prompt` is empty string
   - Add test: `PUT /api/tasks/:id` returns 400 when `status` is not a number
   - Add test: `PUT /api/tasks/:id` returns 400 when `order` is not a number
   - Add test: `PUT /api/tasks/:id` returns 404 when task not found
   - Add test: `PUT /api/tasks/:id` updates only provided fields
   - Add test: `PUT /api/tasks/:id` updates `updatedat` timestamp
   - Add test: `PUT /api/tasks/:id` returns updated task with `status_label`

**Tests**:
- Verify all validation cases
- Verify partial updates
- Verify timestamp updates

**Verification**:
- Tests pass
- Updates work correctly

---

### Step 7.6: DELETE /api/tasks/:id
**Objective**: Test task deletion endpoint.

**Tasks**:
1. Extend `tests/tasks-api.test.ts`:
   - Add test: `DELETE /api/tasks/:id` returns 400 when id is not numeric
   - Add test: `DELETE /api/tasks/:id` returns 404 when task not found
   - Add test: `DELETE /api/tasks/:id` returns 200 with success message when deleted

**Tests**:
- Verify validation
- Verify deletion
- Verify response

**Verification**:
- Tests pass

---

## Phase 8: HTTP Server - Repository & Telegram Routes

### Step 8.1: GET /repositories/api/:repository/files
**Objective**: Test repository file tree endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `GET /repositories/api/:repository/files` returns 400 when repository param is missing
   - Add test: `GET /repositories/api/:repository/files` returns 404 when repository doesn't exist
   - Add test: `GET /repositories/api/:repository/files` returns file tree when repository exists
   - Mock `filesystem.exists()` and `FileTreeService.buildFileTree()`

**Tests**:
- Verify validation
- Verify error handling
- Verify success case

**Verification**:
- Tests pass

---

### Step 8.2: POST /telegram/webhook
**Objective**: Test Telegram webhook endpoint.

**Tasks**:
1. Extend `tests/server.test.ts`:
   - Add test: `POST /telegram/webhook` handles `message` update type
   - Add test: `POST /telegram/webhook` handles `edited_message` update type
   - Add test: `POST /telegram/webhook` handles `callback_query` update type
   - Add test: `POST /telegram/webhook` handles unknown update type
   - Add test: `POST /telegram/webhook` returns 200 even when internal error occurs (with `success: false`)
   - Verify update type is logged correctly

**Tests**:
- Verify all update types
- Verify error handling always returns 200
- Verify logging

**Verification**:
- Tests pass
- Webhook is resilient

---

## Phase 9: Execution Orchestration

### Step 9.1: CursorExecutionService - Repository Validation
**Objective**: Test repository validation logic.

**Tasks**:
1. Create or extend `tests/cursor-execution-service.test.ts`:
   - Add test: `execute()` returns error when `TARGET_APP_PATH` is missing and no repository provided
   - Add test: `execute()` returns error when repository path doesn't exist
   - Add test: `execute()` returns error when workspace is not trusted
   - Mock `GitService`, `FilesystemService`, `WorkspaceTrustService`

**Tests**:
- Verify all validation cases
- Verify error response structure

**Verification**:
- Tests pass
- Validation is comprehensive

---

### Step 9.2: CursorExecutionService - System Instructions
**Objective**: Test system instructions are appended correctly.

**Tasks**:
1. Extend `tests/cursor-execution-service.test.ts`:
   - Add test: `execute()` appends `SYSTEM_SETTINGS_MCP_INSTRUCTIONS` to non-review prompts
   - Add test: `execute()` does not duplicate system instructions across iterations
   - Add test: Review agent prompts do not include system instructions
   - Mock `CommandParserService` and verify prompt construction

**Tests**:
- Verify instruction appending
- Verify no duplication
- Verify review agent exclusion

**Verification**:
- Tests pass
- Instructions are handled correctly

---

### Step 9.3: CursorExecutionService - Execution Flows
**Objective**: Test execute and iterate methods.

**Tasks**:
1. Extend `tests/cursor-execution-service.test.ts`:
   - Add test: `execute()` builds correct cursor-cli command
   - Add test: `execute()` handles `CommandError` with stdout/stderr
   - Add test: `execute()` handles generic `Error`
   - Add test: `execute()` returns `SuccessResponse` with correct structure
   - Add test: `iterate()` respects `maxIterations`
   - Add test: `iterate()` updates `iterations` count in responses
   - Mock `CursorCLI.executeCommand()` and `CommandParserService`

**Tests**:
- Verify command construction
- Verify error handling
- Verify response structures
- Verify iteration logic

**Verification**:
- Tests pass
- Execution flows work correctly

---

### Step 9.4: CursorExecutionService - Callback Webhook
**Objective**: Test callback webhook behavior.

**Tasks**:
1. Extend `tests/cursor-execution-service.test.ts`:
   - Add test: `callbackWebhook()` sends success payload with all required fields
   - Add test: `callbackWebhook()` sends error payload with partial output when command fails
   - Add test: `callbackWebhook()` logs HTTP errors but doesn't throw
   - Mock HTTP client (e.g., `fetch` or `axios`) to simulate callback target

**Tests**:
- Verify payload structure
- Verify error handling
- Verify logging

**Verification**:
- Tests pass
- Callbacks are reliable

---

### Step 9.5: CursorExecutionService - Conversation Integration
**Objective**: Test conversation service integration.

**Tasks**:
1. Extend `tests/cursor-execution-service.test.ts`:
   - Add test: `execute()` uses explicit `conversationId` when provided
   - Add test: `execute()` gets conversation ID from service when not provided
   - Add test: `execute()` adds messages to conversation
   - Add test: `iterate()` maintains conversation across iterations
   - Mock `ConversationService`

**Tests**:
- Verify conversation ID handling
- Verify message storage
- Verify queue type handling

**Verification**:
- Tests pass
- Conversation integration works

---

## Phase 10: CLI Wrapper & Child Process Handling

### Step 10.1: CursorCLI - Semaphore & Queue Status
**Objective**: Test concurrency control.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: Multiple concurrent `executeCommand()` calls respect `CURSOR_CLI_MAX_CONCURRENT`
   - Add test: When all slots busy, additional calls wait and log "waiting"
   - Add test: `getQueueStatus()` returns correct `available` and `waiting` counts
   - Mock `child_process.spawn` to simulate long-running commands

**Tests**:
- Verify semaphore behavior
- Verify queue status accuracy
- Verify logging

**Verification**:
- Tests pass
- Concurrency is controlled correctly

---

### Step 10.2: CursorCLI - Timeout Handling
**Objective**: Test timeout behavior.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: Main timeout triggers `CommandError` with stdout/stderr attached
   - Add test: Idle timeout triggers failure when no output for configured duration
   - Add test: Safety timeout releases semaphore even if exit events don't fire
   - Mock `spawn` to simulate timeout scenarios

**Tests**:
- Verify timeout behavior
- Verify error structure
- Verify semaphore cleanup

**Verification**:
- Tests pass
- Timeouts work correctly

---

### Step 10.3: CursorCLI - PTY vs Spawn
**Objective**: Test PTY usage and fallback.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: PTY is used when `node-pty` is available
   - Add test: Falls back to spawn when PTY fails
   - Add test: Logs reflect PTY vs spawn usage
   - Mock `node-pty` module availability

**Tests**:
- Verify PTY detection
- Verify fallback behavior
- Verify logging

**Verification**:
- Tests pass
- PTY handling is robust

---

### Step 10.4: CursorCLI - SSH Host Key Prompt
**Objective**: Test SSH prompt auto-response.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: SSH host key prompt is detected in PTY output
   - Add test: `write('yes\n')` is called once when prompt detected
   - Add test: Multiple prompts don't cause multiple responses
   - Mock PTY output to include SSH prompt text

**Tests**:
- Verify prompt detection
- Verify auto-response
- Verify no duplicate responses

**Verification**:
- Tests pass
- SSH handling works correctly

---

### Step 10.5: CursorCLI - Output Size Limits
**Objective**: Test output size protection.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: Command is killed when output exceeds `CURSOR_CLI_MAX_OUTPUT_SIZE`
   - Add test: Descriptive error is thrown with size limit information
   - Mock `spawn` to simulate large output

**Tests**:
- Verify size limit enforcement
- Verify error messages

**Verification**:
- Tests pass
- Size limits are enforced

---

### Step 10.6: CursorCLI - extractFilesFromOutput
**Objective**: Test file extraction from output.

**Tasks**:
1. Extend `tests/cursor-cli.test.ts`:
   - Add test: Extracts files from various cursor-cli output formats
   - Add test: Returns empty array when no files found
   - Add test: Handles multiple file patterns

**Tests**:
- Verify extraction patterns
- Verify edge cases

**Verification**:
- Tests pass
- File extraction is reliable

---

## Phase 11: Redis-based Conversation Services

### Step 11.1: ConversationService - getConversationId
**Objective**: Test conversation ID resolution.

**Tasks**:
1. Extend `tests/conversation-service.test.ts` (create if needed):
   - Add test: Explicit `conversationId` is used and last-conversation key not updated
   - Add test: No id provided uses last-conversation key per queue type
   - Add test: Creates new conversation when last-conversation key missing
   - Add test: Returns new UUID when Redis unavailable
   - Use `createMockRedisClient()` helper

**Tests**:
- Verify ID resolution logic
- Verify queue type handling
- Verify fallback behavior

**Verification**:
- Tests pass
- ID resolution works correctly

---

### Step 11.2: ConversationService - Conversation Management
**Objective**: Test conversation creation and retrieval.

**Tasks**:
1. Extend `tests/conversation-service.test.ts`:
   - Add test: `createConversation()` sets TTL and last-conversation key per queue
   - Add test: `forceNewConversation()` clears last-conversation key and creates new
   - Add test: `getConversationContext()` returns messages
   - Add test: `getConversationContext()` prefers summarized messages when available
   - Use mock Redis client

**Tests**:
- Verify conversation creation
- Verify TTL behavior
- Verify context retrieval

**Verification**:
- Tests pass

---

### Step 11.3: ConversationService - Message Storage
**Objective**: Test message storage with debug flag.

**Tasks**:
1. Extend `tests/conversation-service.test.ts`:
   - Add test: `addMessage()` stores non-review messages
   - Add test: `addMessage()` skips review-agent messages when debug disabled
   - Add test: `addMessage()` stores review-agent messages when debug enabled (DB)
   - Add test: `addMessage()` stores review-agent messages when debug enabled (env)
   - Mock `isSystemSettingEnabled('debug')` to return different values

**Tests**:
- Verify message storage
- Verify debug flag behavior
- Verify review agent exclusion

**Verification**:
- Tests pass
- Debug flag works correctly

---

### Step 11.4: AgentConversationService - Basic Operations
**Objective**: Test agent conversation CRUD.

**Tasks**:
1. Extend `tests/agent-conversation-service.test.ts`:
   - Add test: `createConversation()` creates with correct structure
   - Add test: `getConversation()` retrieves conversation
   - Add test: `getConversation()` backfills `conversationId` for old data
   - Add test: `addMessage()` adds message with ID and timestamp
   - Add test: `updateConversation()` persists changes
   - Use mock Redis client

**Tests**:
- Verify CRUD operations
- Verify data structure
- Verify backward compatibility

**Verification**:
- Tests pass

---

### Step 11.5: AgentConversationService - List with Sorting & Pagination
**Objective**: Test listing with options.

**Tasks**:
1. Extend `tests/agent-conversation-service.test.ts`:
   - Add test: `listConversations()` sorts by `createdAt` asc/desc
   - Add test: `listConversations()` sorts by `lastAccessedAt` asc/desc
   - Add test: `listConversations()` sorts by `messageCount` asc/desc
   - Add test: `listConversations()` applies pagination with `limit` and `offset`
   - Add test: `listConversations()` returns empty when Redis unavailable
   - Use mock Redis client with test data

**Tests**:
- Verify sorting
- Verify pagination
- Verify error handling

**Verification**:
- Tests pass
- Sorting and pagination work correctly

---

## Phase 12: Persistence & Migrations

### Step 12.1: TaskService - Basic Operations
**Objective**: Test TaskService CRUD.

**Tasks**:
1. Create `tests/task-service.test.ts`:
   - Add test: `listTasks()` returns all tasks ordered by `order` then `id`
   - Add test: `listTasks(status)` filters by status
   - Add test: `createTask()` creates with timestamps and correct `status_label`
   - Add test: `getTaskById()` returns task or null
   - Use temp SQLite DB with migrations

**Tests**:
- Verify CRUD operations
- Verify ordering
- Verify status labels

**Verification**:
- Tests pass

---

### Step 12.2: TaskService - Update Operations
**Objective**: Test task updates.

**Tasks**:
1. Extend `tests/task-service.test.ts`:
   - Add test: `updateTask()` with no changes returns existing task
   - Add test: `updateTask()` updates only provided fields
   - Add test: `updateTask()` updates `updatedat` timestamp
   - Add test: `deleteTask()` returns true only when row deleted
   - Add test: `close()` closes DB and allows re-open

**Tests**:
- Verify update behavior
- Verify timestamp updates
- Verify deletion
- Verify cleanup

**Verification**:
- Tests pass

---

### Step 12.3: Migration Runner
**Objective**: Test migration system.

**Tasks**:
1. Create `tests/migrations.test.ts`:
   - Add test: `ensureSchemaMigrationsTable()` creates table when missing
   - Add test: `ensureSchemaMigrationsTable()` is idempotent
   - Add test: `runMigrations()` applies all migrations once
   - Add test: `runMigrations()` is idempotent on second call
   - Add test: Migration failures are logged clearly
   - Use temp SQLite DB

**Tests**:
- Verify migration execution
- Verify idempotency
- Verify error handling

**Verification**:
- Tests pass
- Migrations are reliable

---

## Phase 13: System Settings, Gmail MCP, Feature Flags

### Step 13.1: System Settings - Database & Env Fallback
**Objective**: Test system settings reading.

**Tasks**:
1. Extend `tests/system-settings.test.ts`:
   - Add test: `isSystemSettingEnabled()` reads from DB when available
   - Add test: `isSystemSettingEnabled()` falls back to env for `debug` when DB unavailable
   - Add test: `isSystemSettingEnabled()` returns false when setting not found
   - Add test: `closeDatabase()` closes without throwing
   - Use temp SQLite DB and mock DB unavailability

**Tests**:
- Verify DB reading
- Verify fallback behavior
- Verify cleanup

**Verification**:
- Tests pass

---

### Step 13.2: Gmail MCP Configuration
**Objective**: Test Gmail MCP validation.

**Tasks**:
1. Extend `tests/system-settings-gmail-validation.test.ts`:
   - Add test: `getGmailMcpEnabled()` returns false when env not set
   - Add test: `getGmailMcpEnabled()` returns true for various true values
   - Add test: `validateGmailConfig()` returns valid when all vars present
   - Add test: `validateGmailConfig()` returns missing list when vars absent
   - Add test: `CursorRunner.validateGmailConfig()` logs appropriately for all combinations
   - Test all combinations of `ENABLE_GMAIL_MCP` and required env vars

**Tests**:
- Verify enablement logic
- Verify validation
- Verify logging

**Verification**:
- Tests pass
- Gmail config validation is comprehensive

---

### Step 13.3: ElevenLabs Feature Flags
**Objective**: Test ElevenLabs feature flag behavior.

**Tasks**:
1. Extend `tests/feature-flags.test.ts`:
   - Add test: `isElevenLabsEnabled()` handles true/false variants
   - Add test: `isElevenLabsEnabled()` logs warning for invalid values
   - Add test: `isElevenLabsCallbackUrl()` detects ElevenLabs URLs
   - Add test: `shouldSendElevenLabsCallback()` returns true for non-ElevenLabs URLs
   - Add test: `shouldSendElevenLabsCallback()` returns false and logs when feature disabled
   - Add test: `shouldSendElevenLabsCallback()` masks secrets in logs

**Tests**:
- Verify flag logic
- Verify URL detection
- Verify callback suppression
- Verify log masking

**Verification**:
- Tests pass
- Feature flags work correctly

---

## Phase 14: Filesystem & Workspace Services

### Step 14.1: GitService
**Objective**: Test GitService behavior.

**Tasks**:
1. Extend `tests/git-service.test.ts`:
   - Add test: `repositoriesPath` uses env var when set
   - Add test: `repositoriesPath` uses default when env not set
   - Add test: `ensureRepositoriesDirectory()` creates directory when missing
   - Add test: `ensureRepositoriesDirectory()` is idempotent
   - Mock `fs.existsSync` and `fs.mkdirSync`

**Tests**:
- Verify path resolution
- Verify directory creation
- Verify idempotency

**Verification**:
- Tests pass

---

### Step 14.2: FilesystemService, FileTreeService, WorkspaceTrustService
**Objective**: Test filesystem-related services.

**Tasks**:
1. Extend existing tests:
   - Add test: Permission errors are handled gracefully
   - Add test: Path traversal attempts are rejected
   - Add test: `FileTreeService.buildFileTree()` handles nested directories
   - Mock `fs` operations to simulate errors

**Tests**:
- Verify error handling
- Verify security
- Verify functionality

**Verification**:
- Tests pass

---

### Step 14.3: TerminalService
**Objective**: Test terminal service cleanup.

**Tasks**:
1. Extend `tests/terminal-service.test.ts`:
   - Add test: Resources are cleaned up on completion
   - Add test: No hanging timers or child processes
   - Add test: Streaming works correctly
   - Mock child process operations

**Tests**:
- Verify cleanup
- Verify streaming
- Verify no leaks

**Verification**:
- Tests pass

---

## Phase 15: E2E-lite Flows

### Step 15.1: Async Iteration E2E Flow
**Objective**: Test full async iteration workflow.

**Tasks**:
1. Create `tests/e2e/async-iteration.test.ts`:
   - Add test: Full flow from `/cursor/iterate/async` request to callback webhook
   - Mock `CursorExecutionService` to simulate successful iteration
   - Use in-process HTTP server to receive callback
   - Verify callback payload structure matches expected format
   - Verify callback includes all required fields (duration, timestamp, iterations, etc.)

**Tests**:
- Verify end-to-end flow
- Verify callback structure
- Verify error handling

**Verification**:
- Tests pass
- E2E flow works correctly

---

### Step 15.2: Conversation UI E2E Flow
**Objective**: Test conversation UI workflow.

**Tasks**:
1. Create `tests/e2e/conversation-ui.test.ts`:
   - Add test: `POST /api/new` → `POST /api/:conversationId/message` → `GET /api/:conversationId`
   - Verify conversation ID is returned and consistent
   - Verify conversation state evolves correctly
   - Use mock Redis for conversation storage

**Tests**:
- Verify conversation flow
- Verify state consistency
- Verify API contracts

**Verification**:
- Tests pass

---

### Step 15.3: Agent Conversation E2E Flow
**Objective**: Test agent conversation workflow.

**Tasks**:
1. Create `tests/e2e/agent-conversation.test.ts`:
   - Add test: `POST /api/agent/new` → `POST /api/agent/:id/message` → `GET /api/agent/:id`
   - Verify conversation creation
   - Verify message addition
   - Verify conversation retrieval
   - Use mock Redis for storage

**Tests**:
- Verify agent conversation flow
- Verify state management

**Verification**:
- Tests pass

---

## Phase 16: Shell Scripts & CI Integration

### Step 16.1: Wrap Shell Scripts as Jest Tests
**Objective**: Integrate shell-based tests into Jest.

**Tasks**:
1. For each shell script (`test-mcp-connection.sh`, `test-mcp-server.sh`, `test-mcp-spawn.sh`):
   - Create corresponding Jest test file
   - Spawn script with non-interactive flags
   - Assert exit code is 0
   - Optionally capture and verify output

**Tests**:
- Verify scripts execute successfully
- Verify exit codes

**Verification**:
- Tests pass
- Scripts are integrated

---

### Step 16.2: Gmail Smoke Test Integration
**Objective**: Integrate Gmail smoke test as opt-in Jest test.

**Tasks**:
1. Extend `scripts/gmail_smoke_test.ts` or create Jest wrapper:
   - Tag test with `@smoke` or similar
   - Make test skip by default (use `describe.skip` or environment check)
   - Document how to enable in CI with secrets
   - Verify test works when enabled

**Tests**:
- Verify smoke test can run
- Verify it's disabled by default

**Verification**:
- Test is integrated
- Can be enabled in CI

---

### Step 16.3: CI Configuration & Coverage Thresholds
**Objective**: Set up CI test scripts and coverage enforcement.

**Tasks**:
1. Update `package.json` scripts:
   - Ensure `test:unit`, `test:integration`, `test:e2e` are properly configured
   - Add `test:smoke` for opt-in tests
   - Verify scripts work in CI environment

2. Update `jest.config.js`:
   - Raise coverage thresholds gradually (e.g., `lines: 75, branches: 70, functions: 75, statements: 75`)
   - Exclude `index.ts` from coverage requirements
   - Verify coverage report is generated

3. Document CI integration:
   - Update CI configuration files (if any)
   - Document test script usage
   - Document coverage requirements

**Tests**:
- Run all test scripts locally
- Verify coverage thresholds
- Verify CI compatibility

**Verification**:
- All scripts work
- Coverage thresholds are met
- CI is configured

---

## Phase 17: Cross-Repo Strategy

### Step 17.1: Test Sharing Strategy
**Objective**: Ensure tests are shared or synchronized across cursor-runner copies.

**Tasks**:
1. Document strategy:
   - Decide: symlinks, submodule, or manual sync
   - Create sync script if manual sync chosen
   - Document process for keeping tests in sync

2. Verify other repos:
   - Check `assistant-integrations/cursor-runner` and `python-cursor/cursor-runner`
   - Ensure they can run the same test suite
   - Document any differences

**Tests**:
- Verify tests run in all repos
- Verify sync process works

**Verification**:
- Strategy is documented
- Tests are accessible in all repos

---

## Implementation Notes

### Testing Best Practices
- **Isolation**: Each test should be independent and not rely on shared state
- **Cleanup**: Always clean up resources (DB connections, Redis clients, temp files) in `afterEach`/`afterAll`
- **Mocking**: Mock external dependencies (cursor-cli, Redis, HTTP clients) to ensure tests are fast and deterministic
- **Assertions**: Use descriptive assertion messages to make failures clear
- **Coverage**: Aim for high coverage of business logic, but don't obsess over 100% (some error paths may be hard to test)

### Dependencies Between Steps
- Phase 1 (Foundation) must be completed before other phases
- Phase 2 (Core Lifecycle) can be done in parallel with Phase 3 (HTTP Server)
- Phase 4-8 (HTTP Routes) can be done in any order, but follow the order for logical grouping
- Phase 9 (Execution) depends on understanding HTTP routes
- Phase 10 (CLI) is independent but should be done before E2E tests
- Phase 11-14 (Services) can be done in parallel
- Phase 15 (E2E) depends on most other phases being complete
- Phase 16-17 (CI & Cross-repo) should be done last

### Success Criteria
- All tests pass consistently
- Coverage thresholds are met
- Tests run in reasonable time (< 5 minutes for full suite)
- No flaky tests
- CI integration works correctly
- Tests are maintainable and well-documented






