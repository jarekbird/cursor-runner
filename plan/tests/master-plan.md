## cursor-runner Testing Master Plan

### 1. Scope & Goals

- **Scope**: `VirtualAssistant/cursor-runner` (canonical), plus mirrored `cursor-runner` copies in `assistant-integrations` and `python-cursor`.
- **Primary goals**:
  - **Reliability**: cursor-runner runs continuously under external failures (cursor-cli, Redis, SQLite, MCPs, Gmail).
  - **Behavior contracts**: all HTTP APIs and CLIs have explicit, tested contracts (status codes, payloads, and key side effects).
  - **Safety & isolation**: deterministic tests that do not depend on real external services by default.
  - **Maintainability**: shared testing patterns and helpers that keep suites readable and easy to extend.

### 2. Test Architecture & Conventions

- **Framework**: Jest + `ts-jest` (ESM) with tests under `tests/**/*.test.ts`.
- **Test layers**:
  - **Unit**: service classes and utilities in `src/` (fast, fully mocked I/O).
  - **Integration**: HTTP-level tests against `Server` + lightweight backing stores (temp SQLite, in-memory/mocked Redis).
  - **E2E-lite**: small number of flows that exercise HTTP endpoints end-to-end with a mocked `CursorCLI` (no real cursor-cli).
- **Conventions**:
  - Use shared helpers in `tests/helpers/` and `tests/test-utils.ts` for:
    - Creating `Server` with injected mocks.
    - Creating temporary SQLite DBs and running migrations.
    - Creating mock Redis clients.
    - Common assertions for error responses and logging.
  - Prefer dependency injection where possible (e.g., Redis clients, CLI wrappers) to reduce reliance on globals.

### 3. Core Application Lifecycle (CursorRunner in src/index.ts)

- **Objectives**:
  - Ensure startup (`initialize`) fails fast on critical misconfiguration, but tolerates non-critical issues as designed (e.g., migration failures).
  - Ensure shutdown is graceful and does not leak resources.
- **Planned tests**:
  - Constructor and `validateConfig`:
    - Missing `CURSOR_CLI_PATH` ⇒ throws with clear error.
    - Valid env ⇒ no error.
  - `initialize()` happy path with mocks:
    - Mocks for `GitHubAuthService`, migrations, `cursorCLI.validate`, `verifyMcpConfig`, `validateGmailConfig`, and `server.start`.
    - Asserts that calls happen in expected order and logs basic startup info.
  - `initialize()` failure modes:
    - Migrations throw ⇒ log error + warning, but continue startup.
    - `GitHubAuthService.initialize` throws ⇒ initialization fails and error is propagated.
    - `cursorCLI.validate` throws ⇒ initialization fails with descriptive error.
    - `verifyMcpConfig` with missing/present files ⇒ check for correct warnings/info logs.
  - `shutdown()`:
    - Calls `server.stop`.
    - Logs memory usage and call stack.
  - Process/signal behavior (optional node-only suite):
    - Spawn built artifact with `import.meta.url` main guard active.
    - Send `SIGTERM` / `SIGINT` and assert that:
      - `shutdown` is invoked.
      - Process exits with code `0`.
      - Keep-alive interval is cleared (no hanging).

### 4. HTTP Server & API Surface (src/server.ts)

- **Objectives**:
  - All HTTP routes have clear, tested behavior for success and failure cases.
  - Queueing, conversation, and task behaviors are observable and reliable.
- **Planned tests**:
  - **Health & diagnostics**:
    - `GET /health`: returns `{ status: 'ok', service: 'cursor-runner' }` and logs requester info.
    - `GET /health/queue`: mocks `cursorCLI.getQueueStatus()`:
      - Regular status.
      - `available === 0 && waiting > 0` ⇒ `warning` field populated.
  - **Cursor execution routes**:
    - `POST /cursor/execute`:
      - Happy path: `cursorExecution.execute` mocked to return `{ status, body }`.
      - Error path: `execute` throws `Error` ⇒ 500 error JSON with `success: false`.
      - `queueType` taken from body when present, otherwise derived from `requestId` (`telegram-` prefix).
    - `POST /cursor/execute/async`:
      - Missing `callbackUrl`/`callback_url` ⇒ 400 with descriptive message.
      - Happy path: immediate 200 response; later internal call to `cursorExecution.execute` is awaited and errors are sent via `callbackWebhook`.
      - Error in async processing: verify callback is attempted; if callback fails, error is logged only.
    - `POST /cursor/iterate`:
      - Happy path: `cursorExecution.iterate` returns `{ status, body }`.
      - `maxIterations` default of 5 applied correctly.
      - Error path: 500 behavior as for `/cursor/execute`.
    - `POST /cursor/iterate/async`:
      - Auto-build `callbackUrl` via `buildCallbackUrl()` when missing, with log of source.
      - Happy path: 200 immediate response + background `iterate` call.
      - On error, build `ErrorCallbackResponse` including optional `stdout`, `stderr`, and `exitCode`.
  - **Conversation HTTP API (`/api`)**:
    - `GET /api/list`: returns result from `conversationService.listConversations`, with 500 on failure.
    - `POST /api/new`: creates a new conversation via `forceNewConversation(queueType='api' by default)`.
    - `GET /api/working-directory/files`:
      - `TARGET_APP_PATH` not set ⇒ 500 with explanatory error.
      - Directory missing ⇒ 404.
      - Happy path: uses `FileTreeService.buildFileTree` and returns tree.
    - `GET /api/:conversationId`:
      - Reserved paths (`tasks`, `agent`, `working-directory`) are passed through via `next()`.
      - Existing conversation ⇒ returns JSON.
      - Missing conversation ⇒ 404.
    - `POST /api/:conversationId/message`:
      - Missing/empty `message` ⇒ 400.
      - Conversation not found ⇒ 404.
      - Happy path: returns 200 immediately, then kicks off background `cursorExecution.iterate` with `queueType='api'`.
  - **Agent conversation API (`/api/agent`)**:
    - `GET /api/agent/list`:
      - Valid and invalid `limit`, `offset`, `sortBy`, `sortOrder` combinations (400 for invalid).
      - Happy path: returns `conversations` plus `pagination` fields.
    - `POST /api/agent/new`:
      - Optional `agentId` and `metadata`, with persistence via `AgentConversationService`.
    - `POST /api/agent/:id/message`:
      - Missing `role` or `content` ⇒ 400.
      - Happy path: message added, 200 with conversationId.
    - `GET /api/agent/:id`:
      - Conversation not found ⇒ 404.
      - Happy path: returns conversation JSON.
  - **Tasks API (`/api/tasks`)**:
    - Use a temp SQLite DB (via `SHARED_DB_PATH`) and run migrations in test setup.
    - `GET /api/tasks` with and without `status` filter.
    - Invalid `status` query ⇒ 400.
    - `GET /api/tasks/:id`:
      - Non-numeric id ⇒ 400.
      - Not found ⇒ 404.
      - Existing ⇒ returns task with `status_label`.
    - `POST /api/tasks`:
      - Missing/empty `prompt` ⇒ 400.
      - Valid body ⇒ 201 with created task.
    - `PUT /api/tasks/:id`:
      - Invalid id ⇒ 400.
      - Invalid types for `prompt`, `status`, or `order` ⇒ 400.
      - Updates persist and update `updatedat`.
    - `DELETE /api/tasks/:id`:
      - Invalid id ⇒ 400.
      - Not found ⇒ 404.
      - Existing ⇒ 200 with success.
  - **Repository browser API (`/repositories/api/:repository/files`)**:
    - Missing repository ⇒ 400.
    - Non-existent repo path ⇒ 404.
    - Happy path using a test directory and `FileTreeService.buildFileTree`.
  - **Telegram webhook (`/telegram/webhook`)**:
    - Different update shapes (message, edited_message, callback_query, unknown).
    - Internal error path still returns 200 but with `success: false`.

### 5. Execution Orchestration (CursorExecutionService)

- **Objectives**:
  - Validate repository and workspace assumptions before executing cursor-cli.
  - Append system instructions correctly and manage review flow and callbacks.
- **Planned tests** (unit, with injected mocks for `GitService`, `CursorCLI`, `CommandParserService`, `ReviewAgentService`, `FilesystemService`, `WorkspaceTrustService`, `TerminalService`, and `ConversationService`):
  - Repository validation:
    - Missing `TARGET_APP_PATH` and missing repositories produce clear error responses.
    - Untrusted workspace cases (via `WorkspaceTrustService`) return error.
  - TDD/system instructions:
    - Ensure `SYSTEM_SETTINGS_MCP_INSTRUCTIONS` is appended exactly once for non-review prompts.
    - Review-specific prompts are handled without duplicating system text.
  - Execution flows:
    - `execute` builds the correct commands for cursor-cli, handles `CommandError` vs `CommandResult`, and shapes `SuccessResponse` / `ErrorResponse` consistently.
    - `iterate` performs iteration logic, respects `maxIterations`, and updates `iterations` count in responses.
  - Callback webhook:
    - Happy path: sends expected payload (including `duration`, timestamps, and optional `reviewJustification`).
    - Error path: logs and surfaces HTTP errors from callback target but does not crash the worker.

### 6. CLI Wrapper & Child Process Handling (CursorCLI)

- **Objectives**:
  - Prove concurrency limits, timeout behavior, PTY usage, SSH prompt handling, and output-size protection.
- **Planned tests** (with mocks for `child_process.spawn` and `node-pty`):
  - Semaphore and `getQueueStatus`:
    - Multiple overlapping `executeCommand` calls respect `CURSOR_CLI_MAX_CONCURRENT`.
    - When all slots are busy, additional calls log “waiting” and enqueue.
  - Timeouts:
    - Main timeout: long-running command triggers timeout error with `stdout`/`stderr` attached.
    - Idle timeout: no output for `CURSOR_CLI_IDLE_TIMEOUT` triggers failure earlier than main timeout.
    - Safety timeout: ensures semaphore is released even if exit events do not fire.
  - PTY vs spawn:
    - When `node-pty` is loadable, PTY path is used and logs reflect it.
    - On PTY failure, fallback to `spawn` is logged and used.
  - SSH host key prompt:
    - Simulated PTY output containing host-key text causes a single `write('yes\n')` call and logging.
  - Output limits:
    - When combined stdout/stderr exceed `CURSOR_CLI_MAX_OUTPUT_SIZE`, command is killed and a descriptive error is thrown.
  - `extractFilesFromOutput`:
    - Existing tests retained and expanded to include varied cursor-cli output formats.

### 7. Redis-based Conversation Services

- **ConversationService**:
  - Use in-memory or mocked `ioredis`:
    - `getConversationId`:
      - Explicit id is respected, last-conversation keys not updated.
      - No id provided: uses last-conversation key per queue; creates one if missing.
      - Redis unavailable: always returns a new UUID, effectively disabling persistence.
    - `createConversation` & `forceNewConversation`:
      - Ensure TTL and last-conversation keys are set correctly per queue type.
    - `addMessage`:
      - Stores non-review messages.
      - Skips review-agent messages unless `isSystemSettingEnabled('debug')` is true (cover both DB and env-based debug).
    - `getConversationContext` and summarization behavior (at least basic coverage that summarized messages, when present, are preferred).
- **AgentConversationService**:
  - `createConversation`: conversation structure, title, and status fields.
  - `getConversation`: round-trip storage and implicit backfill of `conversationId` for older data.
  - `listConversations`:
    - Sorting by `createdAt`, `lastAccessedAt`, and `messageCount`, both asc/desc.
    - Pagination with `limit` + `offset`.
    - Redis failure ⇒ returns `{ conversations: [], total: 0 }`.
  - `addMessage` and `updateConversation`:
    - Proper message IDs, timestamps, and `lastAccessedAt` updates.

### 8. Persistence & Migrations (SQLite)

- **TaskService**:
  - With temp SQLite DB and real schema:
    - `listTasks` (with/without status) ordering by `"order"` then `id`.
    - `createTask`: inserts with timestamps; retrieves consistent `status_label`.
    - `updateTask`:
      - No-op update returns existing task unchanged.
      - Field-specific updates change only the intended fields and `updatedat`.
    - `deleteTask`: returns `true` only when a row was deleted.
    - `close`: closes DB safely and allows re-open on next use.
- **Migrations**:
  - `ensureSchemaMigrationsTable` creates migrations table when missing, no-op when present.
  - `runMigrations`:
    - Applies all migrations once; second call is idempotent.
    - Logs failures clearly, does not corrupt DB; partial failure behavior is documented and tested as far as practical.

### 9. System Settings, Gmail MCP, and Feature Flags

- **System settings (system-settings.ts)**:
  - `isSystemSettingEnabled`:
    - DB present and setting row exists vs missing.
    - DB unavailable triggers env fallback for `debug`.
  - `closeDatabase`: closes without throwing, logs warnings on error.
- **Gmail MCP**:
  - `getGmailMcpEnabled` and `validateGmailConfig`:
    - All combinations of `ENABLE_GMAIL_MCP` and required env vars.
  - Integration with `CursorRunner.validateGmailConfig`:
    - Logs when config is complete vs missing pieces.
    - No startup failures when Gmail MCP is disabled.
- **Feature flags (utils/feature-flags.ts)**:
  - `isElevenLabsEnabled` for variants of true/false and invalid values (which log warnings and disable feature).
  - `isElevenLabsCallbackUrl` for different URL patterns.
  - `shouldSendElevenLabsCallback`:
    - Non-ElevenLabs URLs ⇒ always true.
    - ElevenLabs URLs + feature disabled ⇒ logs masked URL and returns false.

### 10. Filesystem & Workspace-related Services

- **GitService**:
  - `repositoriesPath` from env vs default.
  - `ensureRepositoriesDirectory` creates missing dir and is idempotent.
- **FilesystemService, FileTreeService, WorkspaceTrustService, TerminalService**:
  - Extend existing tests to cover:
    - Permission errors (mock `fs` to throw).
    - Path traversal attempts and correct handling.
    - Cleanup / close behavior in TerminalService (no hanging timers or child processes).

### 11. E2E-lite HTTP Flows

- **Goals**:
  - Validate key workflows across multiple layers without dependence on real cursor-cli or external MCPs.
- **Planned scenarios**:
  - **Async iteration flow**:
    - `/cursor/iterate/async` with mocked `CursorExecutionService` and callback target:
      - Simulate a successful run, verify callback payload shape.
      - Simulate a failure with partial stdout/stderr.
  - **Conversation UI flow**:
    - `POST /api/new` ⇒ `POST /api/:conversationId/message` ⇒ `GET /api/:conversationId`:
      - Ensure conversation ID is returned and state evolves as expected.
  - **Agent conversation flow**:
    - `POST /api/agent/new` ⇒ `POST /api/agent/:id/message` ⇒ `GET /api/agent/:id`.

### 12. Shell/MCP Scripts & CI Integration

- **Shell-based tests**:
  - Decide for each script (`test-mcp-connection.sh`, `test-mcp-server.sh`, `test-mcp-spawn.sh`, `test-build.sh`, `test-ci.sh`) whether it:
    - Becomes a Jest-wrapped test (spawn script, assert exit code), or
    - Remains a dedicated CI job with clear documentation and ownership.
- **Gmail smoke test (`scripts/gmail_smoke_test.ts`)**:
  - Wrap as an opt-in Jest test (tagged `@smoke`), gated in CI with appropriate secrets and disabled by default.
- **CI configuration**:
  - Split into `test:unit`, `test:integration`, `test:e2e` (and optional `test:smoke`).
  - Once new tests are stable, raise Jest coverage thresholds in `jest.config.js` for `src/` (excluding `index.ts`) to enforce ongoing coverage.

### 13. Cross-Repo Strategy (Other cursor-runner Copies)

- Treat `VirtualAssistant/cursor-runner` as the **canonical** source for `src/` and `tests/`.
- For `assistant-integrations/cursor-runner` and `python-cursor/cursor-runner`:
  - Either share tests via symlinks/submodule or keep them mirrored with a script that diffs the copies.
  - Ensure their CI jobs run the same Jest commands and apply similar coverage thresholds, with exceptions only where a feature does not exist.


