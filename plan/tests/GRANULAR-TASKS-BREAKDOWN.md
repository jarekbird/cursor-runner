# Granular Tasks Breakdown

This document lists all tasks that have been broken down into more granular subtasks for easier development.

## Phase 1: Foundation & Test Infrastructure

### TASK-1.1: Enhance Test Utilities & Helpers
**Status**: ✅ Complete
- [TASK-1.1.1](./1.1.1.md): Create createMockRedisClient() Helper
- [TASK-1.1.2](./1.1.2.md): Create createTempSqliteDb() Helper
- [TASK-1.1.3](./1.1.3.md): Create createMockCursorCLI() Helper
- [TASK-1.1.4](./1.1.4.md): Create createMockServer() Helper
- [TASK-1.1.5](./1.1.5.md): Create assertErrorResponse() Helper
- [TASK-1.1.6](./1.1.6.md): Create assertSuccessResponse() Helper

### TASK-1.2: Test Configuration & Coverage Setup
**Status**: ✅ Complete
- [TASK-1.2.1](./1.2.1.md): Update Jest Configuration for Coverage and Test Types
- [TASK-1.2.2](./1.2.2.md): Add Test Scripts to package.json

## Phase 2: Core Application Lifecycle

### TASK-2.1: CursorRunner Constructor & Config Validation
**Status**: 🚧 In Progress
- [TASK-2.1.1](./2.1.1.md): Test CursorRunner Constructor with Dependencies
- TASK-2.1.2: Test validateConfig throws when CURSOR_CLI_PATH is missing
- TASK-2.1.3: Test validateConfig succeeds when CURSOR_CLI_PATH is set
- TASK-2.1.4: Test validateConfig handles multiple missing env vars

### TASK-2.2: CursorRunner.initialize() - Happy Path
**Status**: ⏳ Pending
- TASK-2.2.1: Test initialize() calls validateConfig()
- TASK-2.2.2: Test initialize() calls migrations
- TASK-2.2.3: Test initialize() calls GitHubAuthService.initialize()
- TASK-2.2.4: Test initialize() calls verifyMcpConfig()
- TASK-2.2.5: Test initialize() calls validateGmailConfig()
- TASK-2.2.6: Test initialize() calls cursorCLI.validate()
- TASK-2.2.7: Test initialize() calls server.start()
- TASK-2.2.8: Test initialize() logs startup messages

### TASK-2.4: CursorRunner.initialize() - Critical Failure Handling
**Status**: ⏳ Pending
- TASK-2.4.1: Test initialize() fails when GitHubAuthService.initialize() throws
- TASK-2.4.2: Test initialize() fails when cursorCLI.validate() throws

### TASK-2.5: CursorRunner.initialize() - MCP Config Verification
**Status**: ⏳ Pending
- TASK-2.5.1: Test verifyMcpConfig() logs warning when mcp.json is missing
- TASK-2.5.2: Test verifyMcpConfig() logs info when mcp.json exists
- TASK-2.5.3: Test verifyMcpConfig() logs warning when cursor-agents server is missing
- TASK-2.5.4: Test verifyMcpConfig() logs info when cursor-agents server exists

### TASK-2.6: CursorRunner.shutdown()
**Status**: ⏳ Pending
- TASK-2.6.1: Test shutdown() calls server.stop()
- TASK-2.6.2: Test shutdown() logs memory usage
- TASK-2.6.3: Test shutdown() logs call stack information
- TASK-2.6.4: Test shutdown() handles errors gracefully

## Phase 4: HTTP Server - Cursor Execution Routes

### TASK-4.1: POST /cursor/execute (Synchronous)
**Status**: ⏳ Pending
- TASK-4.1.1: Test POST /cursor/execute happy path
- TASK-4.1.2: Test POST /cursor/execute with queueType in body
- TASK-4.1.3: Test POST /cursor/execute detects queueType from requestId
- TASK-4.1.4: Test POST /cursor/execute returns 500 when execute() throws
- TASK-4.1.5: Test POST /cursor/execute generates requestId when not provided

### TASK-4.2: POST /cursor/execute/async
**Status**: ⏳ Pending
- TASK-4.2.1: Test POST /cursor/execute/async returns 400 when callbackUrl is missing
- TASK-4.2.2: Test POST /cursor/execute/async returns 200 immediately
- TASK-4.2.3: Test POST /cursor/execute/async processes execution in background
- TASK-4.2.4: Test POST /cursor/execute/async sends callback on success
- TASK-4.2.5: Test POST /cursor/execute/async sends error callback when execution fails
- TASK-4.2.6: Test POST /cursor/execute/async logs callback errors but doesn't crash

### TASK-4.3: POST /cursor/iterate (Synchronous)
**Status**: ⏳ Pending
- TASK-4.3.1: Test POST /cursor/iterate happy path
- TASK-4.3.2: Test POST /cursor/iterate uses default maxIterations of 5
- TASK-4.3.3: Test POST /cursor/iterate uses provided maxIterations
- TASK-4.3.4: Test POST /cursor/iterate returns 500 when iterate() throws

### TASK-4.4: POST /cursor/iterate/async
**Status**: ⏳ Pending
- TASK-4.4.1: Test POST /cursor/iterate/async auto-constructs callbackUrl when missing
- TASK-4.4.2: Test POST /cursor/iterate/async logs callback URL source
- TASK-4.4.3: Test POST /cursor/iterate/async returns 200 immediately
- TASK-4.4.4: Test POST /cursor/iterate/async processes iteration in background
- TASK-4.4.5: Test POST /cursor/iterate/async sends error callback with ErrorCallbackResponse structure

## Phase 5: HTTP Server - Conversation API

### TASK-5.4: GET /api/:conversationId
**Status**: ⏳ Pending
- TASK-5.4.1: Test GET /api/:conversationId returns 404 when conversation not found
- TASK-5.4.2: Test GET /api/:conversationId returns conversation when found
- TASK-5.4.3: Test GET /api/tasks passes through to tasks router
- TASK-5.4.4: Test GET /api/agent passes through to agent router
- TASK-5.4.5: Test GET /api/working-directory passes through

### TASK-5.5: POST /api/:conversationId/message
**Status**: ⏳ Pending
- TASK-5.5.1: Test POST /api/:conversationId/message returns 400 when message is missing
- TASK-5.5.2: Test POST /api/:conversationId/message returns 400 when message is empty
- TASK-5.5.3: Test POST /api/:conversationId/message returns 404 when conversation not found
- TASK-5.5.4: Test POST /api/:conversationId/message returns 200 immediately
- TASK-5.5.5: Test POST /api/:conversationId/message triggers background iterate()

## Phase 6: HTTP Server - Agent Conversation API

### TASK-6.1: GET /api/agent/list
**Status**: ⏳ Pending
- TASK-6.1.1: Test GET /api/agent/list returns 400 when limit is invalid
- TASK-6.1.2: Test GET /api/agent/list returns 400 when offset is invalid
- TASK-6.1.3: Test GET /api/agent/list returns 400 when sortBy is invalid
- TASK-6.1.4: Test GET /api/agent/list returns 400 when sortOrder is invalid
- TASK-6.1.5: Test GET /api/agent/list returns conversations with pagination metadata
- TASK-6.1.6: Test GET /api/agent/list applies sorting correctly

### TASK-6.3: POST /api/agent/:id/message
**Status**: ⏳ Pending
- TASK-6.3.1: Test POST /api/agent/:id/message returns 400 when role is missing
- TASK-6.3.2: Test POST /api/agent/:id/message returns 400 when content is missing
- TASK-6.3.3: Test POST /api/agent/:id/message adds message and returns success
- TASK-6.3.4: Test POST /api/agent/:id/message sets default source='text'

## Phase 7: HTTP Server - Tasks API

### TASK-7.2: GET /api/tasks
**Status**: ⏳ Pending
- TASK-7.2.1: Test GET /api/tasks returns all tasks when no filter
- TASK-7.2.2: Test GET /api/tasks?status=0 returns only ready tasks
- TASK-7.2.3: Test GET /api/tasks?status=1 returns only complete tasks
- TASK-7.2.4: Test GET /api/tasks?status=invalid returns 400

### TASK-7.4: POST /api/tasks
**Status**: ⏳ Pending
- TASK-7.4.1: Test POST /api/tasks returns 400 when prompt is missing
- TASK-7.4.2: Test POST /api/tasks returns 400 when prompt is empty string
- TASK-7.4.3: Test POST /api/tasks returns 400 when prompt is not a string
- TASK-7.4.4: Test POST /api/tasks creates task with default order=0 and status=0
- TASK-7.4.5: Test POST /api/tasks creates task with provided order and status
- TASK-7.4.6: Test POST /api/tasks returns 201 with created task including status_label

### TASK-7.5: PUT /api/tasks/:id
**Status**: ⏳ Pending
- TASK-7.5.1: Test PUT /api/tasks/:id returns 400 when id is not numeric
- TASK-7.5.2: Test PUT /api/tasks/:id returns 400 when prompt is empty string
- TASK-7.5.3: Test PUT /api/tasks/:id returns 400 when status is not a number
- TASK-7.5.4: Test PUT /api/tasks/:id returns 400 when order is not a number
- TASK-7.5.5: Test PUT /api/tasks/:id returns 404 when task not found
- TASK-7.5.6: Test PUT /api/tasks/:id updates only provided fields
- TASK-7.5.7: Test PUT /api/tasks/:id updates updatedat timestamp
- TASK-7.5.8: Test PUT /api/tasks/:id returns updated task with status_label

## Phase 8: HTTP Server - Repository & Telegram Routes

### TASK-8.2: POST /telegram/webhook
**Status**: ⏳ Pending
- TASK-8.2.1: Test POST /telegram/webhook handles message update type
- TASK-8.2.2: Test POST /telegram/webhook handles edited_message update type
- TASK-8.2.3: Test POST /telegram/webhook handles callback_query update type
- TASK-8.2.4: Test POST /telegram/webhook handles unknown update type
- TASK-8.2.5: Test POST /telegram/webhook returns 200 even when internal error occurs

## Phase 9: Execution Orchestration

### TASK-9.1: CursorExecutionService - Repository Validation
**Status**: ⏳ Pending
- TASK-9.1.1: Test execute() returns error when TARGET_APP_PATH is missing
- TASK-9.1.2: Test execute() returns error when repository path doesn't exist
- TASK-9.1.3: Test execute() returns error when workspace is not trusted

### TASK-9.3: CursorExecutionService - Execution Flows
**Status**: ⏳ Pending
- TASK-9.3.1: Test execute() builds correct cursor-cli command
- TASK-9.3.2: Test execute() handles CommandError with stdout/stderr
- TASK-9.3.3: Test execute() handles generic Error
- TASK-9.3.4: Test execute() returns SuccessResponse with correct structure
- TASK-9.3.5: Test iterate() respects maxIterations
- TASK-9.3.6: Test iterate() updates iterations count in responses

### TASK-9.4: CursorExecutionService - Callback Webhook
**Status**: ⏳ Pending
- TASK-9.4.1: Test callbackWebhook() sends success payload with all required fields
- TASK-9.4.2: Test callbackWebhook() sends error payload with partial output
- TASK-9.4.3: Test callbackWebhook() logs HTTP errors but doesn't throw

### TASK-9.5: CursorExecutionService - Conversation Integration
**Status**: ⏳ Pending
- TASK-9.5.1: Test execute() uses explicit conversationId when provided
- TASK-9.5.2: Test execute() gets conversation ID from service when not provided
- TASK-9.5.3: Test execute() adds messages to conversation
- TASK-9.5.4: Test iterate() maintains conversation across iterations

## Phase 10: CLI Wrapper & Child Process Handling

### TASK-10.1: CursorCLI - Semaphore & Queue Status
**Status**: ⏳ Pending
- TASK-10.1.1: Test multiple concurrent executeCommand() calls respect MAX_CONCURRENT
- TASK-10.1.2: Test when all slots busy, additional calls wait and log "waiting"
- TASK-10.1.3: Test getQueueStatus() returns correct available and waiting counts

### TASK-10.2: CursorCLI - Timeout Handling
**Status**: ⏳ Pending
- TASK-10.2.1: Test main timeout triggers CommandError with stdout/stderr
- TASK-10.2.2: Test idle timeout triggers failure when no output
- TASK-10.2.3: Test safety timeout releases semaphore even if exit events don't fire

### TASK-10.3: CursorCLI - PTY vs Spawn
**Status**: ⏳ Pending
- TASK-10.3.1: Test PTY is used when node-pty is available
- TASK-10.3.2: Test falls back to spawn when PTY fails
- TASK-10.3.3: Test logs reflect PTY vs spawn usage

### TASK-10.4: CursorCLI - SSH Host Key Prompt
**Status**: ⏳ Pending
- TASK-10.4.1: Test SSH host key prompt is detected in PTY output
- TASK-10.4.2: Test write('yes\n') is called once when prompt detected
- TASK-10.4.3: Test multiple prompts don't cause multiple responses

## Phase 11: Redis-based Conversation Services

### TASK-11.1: ConversationService - getConversationId
**Status**: ⏳ Pending
- TASK-11.1.1: Test explicit conversationId is used and last-conversation key not updated
- TASK-11.1.2: Test no id provided uses last-conversation key per queue type
- TASK-11.1.3: Test creates new conversation when last-conversation key missing
- TASK-11.1.4: Test returns new UUID when Redis unavailable

### TASK-11.2: ConversationService - Conversation Management
**Status**: ⏳ Pending
- TASK-11.2.1: Test createConversation() sets TTL and last-conversation key
- TASK-11.2.2: Test forceNewConversation() clears last-conversation key and creates new
- TASK-11.2.3: Test getConversationContext() returns messages
- TASK-11.2.4: Test getConversationContext() prefers summarized messages when available

### TASK-11.3: ConversationService - Message Storage
**Status**: ⏳ Pending
- TASK-11.3.1: Test addMessage() stores non-review messages
- TASK-11.3.2: Test addMessage() skips review-agent messages when debug disabled
- TASK-11.3.3: Test addMessage() stores review-agent messages when debug enabled (DB)
- TASK-11.3.4: Test addMessage() stores review-agent messages when debug enabled (env)

### TASK-11.4: AgentConversationService - Basic Operations
**Status**: ⏳ Pending
- TASK-11.4.1: Test createConversation() creates with correct structure
- TASK-11.4.2: Test getConversation() retrieves conversation
- TASK-11.4.3: Test getConversation() backfills conversationId for old data
- TASK-11.4.4: Test addMessage() adds message with ID and timestamp
- TASK-11.4.5: Test updateConversation() persists changes

### TASK-11.5: AgentConversationService - List with Sorting & Pagination
**Status**: ⏳ Pending
- TASK-11.5.1: Test listConversations() sorts by createdAt asc/desc
- TASK-11.5.2: Test listConversations() sorts by lastAccessedAt asc/desc
- TASK-11.5.3: Test listConversations() sorts by messageCount asc/desc
- TASK-11.5.4: Test listConversations() applies pagination with limit and offset
- TASK-11.5.5: Test listConversations() returns empty when Redis unavailable

## Phase 12: Persistence & Migrations

### TASK-12.1: TaskService - Basic Operations
**Status**: ⏳ Pending
- TASK-12.1.1: Test listTasks() returns all tasks ordered by order then id
- TASK-12.1.2: Test listTasks(status) filters by status
- TASK-12.1.3: Test createTask() creates with timestamps and correct status_label
- TASK-12.1.4: Test getTaskById() returns task or null

### TASK-12.2: TaskService - Update Operations
**Status**: ⏳ Pending
- TASK-12.2.1: Test updateTask() with no changes returns existing task
- TASK-12.2.2: Test updateTask() updates only provided fields
- TASK-12.2.3: Test updateTask() updates updatedat timestamp
- TASK-12.2.4: Test deleteTask() returns true only when row deleted
- TASK-12.2.5: Test close() closes DB and allows re-open

### TASK-12.3: Migration Runner
**Status**: ⏳ Pending
- TASK-12.3.1: Test ensureSchemaMigrationsTable() creates table when missing
- TASK-12.3.2: Test ensureSchemaMigrationsTable() is idempotent
- TASK-12.3.3: Test runMigrations() applies all migrations once
- TASK-12.3.4: Test runMigrations() is idempotent on second call
- TASK-12.3.5: Test migration failures are logged clearly

## Notes

- ✅ = Complete (task file created with full template)
- 🚧 = In Progress (task file started)
- ⏳ = Pending (needs to be created)

Tasks that are not listed here either:
1. Don't need granular breakdown (single focused task)
2. Are already simple enough
3. Will be created as needed








