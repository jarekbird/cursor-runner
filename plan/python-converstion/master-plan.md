### Cursor Executor Python Port – Master Plan

Using the existing Node.js `cursor-runner` repository (`https://github.com/jarekbird/cursor-runner.git`) as the reference implementation, this plan describes how to build a **feature‑complete Python clone** called `cursor-executor`. The goal is to preserve all current behavior and edge‑case handling while adopting **Pythonic design, tooling, and deployment practices**.

---

### 1. High‑Level Goals and Constraints

- **Goal**: Re‑implement `cursor-runner` in Python as `cursor-executor` with:
  - Same external API surface (HTTP endpoints, CLI behavior, integration contracts).
  - Same core capabilities (cursor CLI orchestration, git operations, filesystem ops, terminal execution, agent integration, TDD workflow support, etc.).
  - Equivalent error handling, safety guarantees, and logging.
- **Constraints**:
  - Stay **as close as practical** to existing behavior (code paths, parameters, defaults, and edge cases) to leverage existing knowledge and docs.
  - Prefer **Python best practices** (type hints, packaging, logging, testing, concurrency) over 1:1 line‑by‑line translation where there is a clear idiomatic advantage.
  - Keep **infrastructure assumptions compatible** with the current Docker, jarek‑va, and ElevenLabs agent workflows, or document any necessary adjustments.

Deliverable: a Python service that `jarek-va` and other tools can treat as a drop‑in replacement for `cursor-runner`, with minimal integration changes.

---

### 2. Inventory the Existing `cursor-runner` Features

**2.1. Core Services (from `src/`) – High-Level Overview**

- **HTTP server / entrypoint** (`server.ts`, `index.ts`):
  - Health and diagnostics endpoints (`/health`, `/health/queue`).
  - Cursor execution API (`/cursor/execute`, `/cursor/execute/async`, `/cursor/iterate`, `/cursor/iterate/async`, `/cursor/conversation/new`).
  - Conversation history API (`/conversations/api/*`).
  - Agent conversation API (`/agent-conversations/api/*`).
  - Telegram webhook endpoint (`/telegram/webhook`).
  - Repository file browser API (`/repositories/api/:repository/files`).
- **Cursor CLI integration**:
  - `cursor-cli.ts`, `cursor-execution-service.ts`, `system-settings.ts`, `target-app.ts`.
  - Handles spawning `cursor` CLI, timeouts, large/streaming output, environment variables, TDD phases, and integration with target apps.
- **Git and completion services**:
  - `git-service.ts`, `git-completion-checker.ts`, `github-auth.ts`.
  - Manages repository root path, git auth and non-interactive configuration, and “definition of done” (PR or pushes).
- **Filesystem and file-tree services**:
  - `filesystem-service.ts`, `file-tree-service.ts`, `workspace-trust-service.ts`.
  - Path existence abstraction, file-tree generation with ignore rules, workspace trust and cursor-cli permissions bootstrapping.
- **Terminal service**:
  - `terminal-service.ts`.
  - Generic terminal execution with hard timeouts and output caps.
- **Request / response helpers**:
  - `request-formatter.ts`, `error-utils.ts`, `logger.ts`, `system-settings.ts`.
  - Canonical TDD request/response shaping, error message/stack handling, shared settings via SQLite, structured logging.
- **Conversation and agent services**:
  - `conversation-service.ts`, `agent-conversation-service.ts`, `review-agent-service.ts`, `callback-url-builder.ts`, `command-parser-service.ts`.
  - Maintain conversation history, handle review agent loops, build callback URLs, and parse/augment cursor command arguments.

**2.2. Cross‑Cutting Concerns**

- **Configuration**:
  - `.env.example`, `system-settings.ts`, Docker env usage.
  - Ports, cursor CLI path and timeout, API keys, repo paths, terminal limits, jarek‑va URL, webhook secret, shared DB path, etc.
- **Security & safety**:
  - Command whitelisting/blacklisting (via workspace trust and cursor-cli permissions).
  - Path validation and controlled repositories root.
  - Subprocess timeouts and idle detection (cursor, terminal, target apps).
  - Output size limits to avoid memory and log flooding.
  - Git auth bootstrapping and non-interactive config (no interactive prompts).
- **Testing and CI**:
  - Tests in `tests/` for each major service (server, cursor-cli, filesystem, git service, file tree, terminal, conversations).
  - `jest.config.js`, `test-ci.sh`, GitHub Actions workflows.
  - Helper utilities (e.g. `helpers/test-helpers.ts`, `test-utils.ts`) and integration tests.

Action: For each of the above, map the TypeScript modules to future Python modules one‑to‑one so we don’t lose functionality or edge cases.

---

### 2.3. Deeper Feature and Edge-Case Inventory (By Service)

This section captures **concrete behaviors and edge cases** that the Python port must replicate.

- **HTTP server and API surface (`server.ts`)**
  - **Health endpoints**:
    - `GET /health`:
      - Always returns `200` with `{ status: 'ok', service: 'cursor-runner' }`.
      - Logs IP, user agent, and service name.
    - `GET /health/queue`:
      - Uses `cursorCLI.getQueueStatus()` to return `{ status: 'ok', service, queue: { available, waiting, maxConcurrent }, warning? }`.
      - Adds a human-readable warning if `available === 0` and `waiting > 0` (indicating potential hung processes).
  - **Cursor execution endpoints**:
    - `POST /cursor/execute` (sync):
      - Request body `CursorExecuteRequest`:
        - `id?`, `repository?`, `branchName?`, `prompt` (required), `callbackUrl?`, `callback_url?`, `conversationId?`, `conversation_id?`, `maxIterations?`, `queueType?`.
      - Behavior:
        - Generates default `requestId` when missing using timestamp and random suffix.
        - Logs full request context (body, IP, user-agent).
        - Derives `queueType` either from body or via `detectQueueType` based on `requestId` prefix (`telegram-` → `telegram`, else `default`).
        - Delegates to `cursorExecution.execute`, passing through conversation and queue information.
        - Expects a result with `status` and `body` and uses that to set HTTP status and JSON response.
      - Error handling:
        - Catches errors, logs with stack, requestId, body, and only sends a `500` JSON error if headers have not already been sent (preventing double-send).
    - `POST /cursor/execute/async`:
      - Validates that a callback URL is supplied (`callbackUrl` or `callback_url`); if missing:
        - Immediately responds `400` with `{ success: false, error: 'callbackUrl is required for async execution', requestId, timestamp }`.
      - On valid callback URL:
        - Responds `200` immediately with `{ success: true, message: 'Request accepted, processing asynchronously', requestId, timestamp }`.
        - Kicks off `cursorExecution.execute` in the background:
          - Logs failures and, if a callback URL is still available, tries to send a minimal error callback (`success: false`, `requestId`, `error`, `timestamp`).
          - Any error when sending the callback is logged but not rethrown.
    - `POST /cursor/iterate` / `POST /cursor/iterate/async`:
      - Mirror the same sync/async patterns and error handling as `/execute`:
        - Use a default `maxIterations` of 5 when not supplied.
        - For async:
          - For `/cursor/iterate/async` specifically:
            - Accepts optional `callbackUrl`/`callback_url`:
              - If missing, uses `buildCallbackUrl()` which:
                - Prefers `JAREK_VA_URL` and falls back to `http://app:3000`.
              - Logs how the callback URL was constructed (env vs Docker default).
            - Responds `200` and then fires `cursorExecution.iterate` in background, with the same behavior around error callbacks as above.
  - **Conversation management endpoints**:
    - `POST /cursor/conversation/new`:
      - Accepts optional `queueType` (defaults to `'default'`).
      - Logs IP, user-agent, queueType.
      - Uses `cursorExecution.conversationService.forceNewConversation(queueType)` to ensure a new, distinct conversation ID is generated, and returns `{ success, conversationId, message, queueType }`.
    - Conversation history APIs at `/conversations/api/*`:
      - All responses are explicitly marked as non-cacheable to avoid stale UI in deployments.
      - `GET /conversations/api/list`:
        - Returns the conversations array directly from `ConversationService.listConversations()`.
        - On failure, returns `500` with `{ success: false, error }`.
      - `POST /conversations/api/new`:
        - Accepts optional `queueType` (defaults to `'api'`).
        - Logs IP, user-agent, queueType.
        - Uses `forceNewConversation(queueType)` and returns a success payload similar to `/cursor/conversation/new`.
      - `GET /conversations/api/:conversationId`:
        - Validates ID existence; returns `404` with `{ success: false, error: 'Conversation not found' }` when not present.
        - On success returns the full conversation object.
      - `POST /conversations/api/:conversationId/message`:
        - Validates:
          - `message` exists and is a non-empty string → else `400` with a descriptive error.
          - Conversation ID exists → else `404`.
        - On success:
          - Generates a UI-specific `requestId` (`ui-...`).
          - Logs message length and optional repo/branch.
          - Returns `200` immediately with an acceptance payload (`success`, `message`, `requestId`, `conversationId`, `timestamp`).
          - Asynchronously calls `cursorExecution.iterate` with `queueType: 'api'`, `maxIterations: 5`.
          - Any async failures are logged but not surfaced to the initial HTTP response.
  - **Agent-conversation API**:
    - `GET /agent-conversations/api/list`:
      - Returns all agent conversations via `AgentConversationService.listConversations()`.
    - `POST /agent-conversations/api/new`:
      - Accepts `{ agentId?, metadata? }`.
      - Creates a conversation and optionally persists metadata (requires an extra `updateConversation` call).
      - Returns `{ success, conversationId, message }`.
    - `POST /agent-conversations/api/:id/message`:
      - Validates presence of `role` and `content`; missing values result in `400` with clear error.
      - Creates an `AgentMessage` with `role`, `content`, auto-generated timestamp, and optional `source` (default `'text'`).
      - Adds message via `AgentConversationService.addMessage`, then returns basic success metadata.
    - `GET /agent-conversations/api/:id`:
      - Returns `404` with `{ success: false, error: 'Agent conversation not found' }` when missing.
  - **Telegram webhook**:
    - `POST /telegram/webhook`:
      - Logs incoming updates and deduces `updateType`:
        - `'message'`, `'edited_message'`, `'callback_query'`, or `'unknown'`.
      - Always returns `200` with `{ success: true/false, received: true, updateType, timestamp }`:
        - Even when internal processing errors occur, HTTP status remains `200` to prevent jarek-va from retrying.
      - Handles empty/malformed updates gracefully (never crashes, always responds).
  - **Repository file browser**:
    - `GET /repositories/api/:repository/files`:
      - Validates repository param; returns `400` if missing.
      - Uses `gitService.repositoriesPath` + repository and `filesystem.exists`:
        - On missing repo: `404` with `Repository '<name>' not found`.
      - Uses `FileTreeService.buildFileTree`:
        - Returns `FileNode[]` representing a filtered, sorted tree (dirs before files).
      - Any internal errors produce `500` with a timestamped JSON error.
  - **Global error handler**:
  - Logs a detailed error context including path, method, IP, body, query, and key headers.
  - Maps error names (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`) to 400/401/403/404; otherwise defaults to 500.
  - Returns JSON `{ success: false, error, timestamp, path, stack? }`, where `stack` is only included in development builds.

### 2.4. Stability & Resilience Behaviors (Recent Additions)

These behaviors were added to make `cursor-runner` more robust; the Python port **must** preserve them.

- **Application lifecycle resilience**:
  - Startup (`CursorRunner.initialize`) fails fast on **critical misconfiguration** (e.g., missing `CURSOR_CLI_PATH` or invalid cursor CLI), but **continues** when non‑critical steps like DB migrations fail, logging clear errors instead of crashing.
  - Shutdown is graceful: `shutdown` closes the HTTP server, logs memory usage, and avoids leaving background timers or intervals running.
- **Cursor CLI concurrency and timeouts**:
  - A semaphore enforces `CURSOR_CLI_MAX_CONCURRENT` limits; additional calls queue and are surfaced via `getQueueStatus()` (used by `/health/queue` for operational visibility).
  - Multiple timeout layers:
    - **Main timeout** based on `CURSOR_CLI_TIMEOUT`.
    - **Idle timeout** when there is no output for `CURSOR_CLI_IDLE_TIMEOUT`, which now **also** releases the semaphore to avoid leaks.
    - **Safety timeout** that fires after the main timeout to ensure the semaphore is **always released** even if normal child‑process events never fire, preventing hung queues.
  - Output size is capped by `CURSOR_CLI_MAX_OUTPUT_SIZE`; when exceeded, the command is killed and a descriptive error is returned.
  - PTY vs. regular spawn:
    - Prefers PTY when available (for interactive prompts like SSH host key confirmation) and logs which path is used.
    - Falls back to `spawn` on PTY failures without crashing.
- **Redis‑backed conversation services with graceful degradation**:
  - `ConversationService` and `AgentConversationService` use Redis with:
    - Bounded `retryStrategy` (stop retrying after a few attempts).
    - `lazyConnect: true` and `enableOfflineQueue: false` so the app does **not** hang or silently buffer commands when Redis is unavailable.
  - When Redis cannot be reached or operations fail:
    - `redisAvailable` is flipped to `false`.
    - `ConversationService.getConversationId` generates new UUIDs on each call so requests continue, but **context persistence is disabled** (conversation history is best‑effort rather than a hard dependency).
    - `AgentConversationService` returns empty lists / default structures instead of throwing, so agent‑related UIs degrade gracefully.
  - TTLs and “last conversation” keys are scoped per queue (`default`, `telegram`, `api`) to keep conversations isolated by channel while still supporting “continue the last conversation” semantics.
- **Conversation context summarization for context-window errors**:
  - `ConversationService` can **summarize long conversations** when the model’s context window is exceeded.
  - `CursorExecutionService` inspects combined stdout/stderr for context‑window errors (both on success and on `CommandError`) and calls `summarizeConversationIfNeeded`:
    - Fetches the current conversation (preferring any existing `summarizedMessages`).
    - Uses a summarizer function to compress history into a single `[Conversation Summary] ...` message plus the last few recent messages.
    - Writes the summarized context back to Redis and logs original vs summarized message counts.
  - On summarization failure, the service logs a warning and flips `redisAvailable` to `false`, falling back to stateless behavior rather than crashing or repeatedly failing iterations.
- **Async callback behavior and external failures**:
  - For async routes (`/cursor/execute/async`, `/cursor/iterate/async`, conversation message endpoints):
    - HTTP handlers **always** return a definitive response (usually `200` or `400`) and never block indefinitely on downstream failures.
    - Failures when invoking callback webhooks are logged with rich context (status codes, bodies) but do **not** crash the worker or rethrow into the HTTP layer.
  - Callback payloads include duration, timestamps, and (when applicable) partial stdout/stderr so callers can still debug failed runs.
- **Iteration‑loop observability and safeguards**:
  - `CursorExecutionService.iterate` logs Node.js `process.memoryUsage()` at the start and end of iterations (especially around higher iteration counts) to help detect memory leaks under long‑running workloads.
  - When cursor CLI calls fail mid‑iteration, any partial output from stdout/stderr is:
    - Captured into the iteration result.
    - Stored back into the conversation history as an assistant message so context is not lost.
  - If a failure occurs **without** any partial output, the error is rethrown to break out of the iteration loop rather than spinning on an unrecoverable state.
- **Redis and SQLite as non‑fatal dependencies**:
  - Redis:
    - Connection errors are logged as warnings or errors with clear messages (e.g., “conversation context will not be persisted”) but do not bring down the process.
  - SQLite:
    - Migrations are idempotent; failures are logged and do not corrupt the DB.
    - Task service closes connections cleanly and can reopen on demand, avoiding file‑handle leaks.
- **System settings, feature flags, and MCP config**:
  - `isSystemSettingEnabled` falls back to env vars (e.g., `DEBUG`) when the settings DB is unavailable, so debug behavior can still be toggled.
  - Gmail MCP, Redis MCP, and SQLite MCP integrations validate configuration at startup and log missing pieces without hard‑failing when the feature is disabled.
  - Feature flags (e.g., ElevenLabs callbacks) default to **safe off** on invalid configuration and mask sensitive URLs in logs.

---

### 2.5. Product & User Story View

This section describes `cursor-executor` from the perspective of the people and systems that use it, then ties each story back to concrete modules (see also `TO-DO.md` for exhaustive file lists).

- **Story A – “Run a code task against a repo from jarek-va”**
  - As a **Virtual Assistant operator**, I can ask jarek‑va to “implement feature X” and have that request executed safely against a Git repository.
  - Flows:
    - jarek‑va calls `/cursor/execute` or `/cursor/iterate/async` with repo/branch + prompt.
    - `cursor-executor` validates configuration, resolves repo paths, ensures workspace trust, runs cursor CLI with TDD/system instructions, and reports results (including callbacks).
  - Key modules:
    - HTTP: `server.ts`, `index.ts`.
    - Execution: `cursor-execution-service.ts`, `cursor-cli.ts`, `request-formatter.ts`, `error-utils.ts`, `logger.ts`, `system-settings.ts`, `workspace-trust-service.ts`, `target-app.ts`.
    - Git/FS: `git-service.ts`, `git-completion-checker.ts`, `filesystem-service.ts`, `file-tree-service.ts`.
    - Tests: `server.test.ts`, `cursor-cli.test.ts`, `git-service.test.ts`, `filesystem-service.test.ts`, `file-tree-service.test.ts`, `request-formatter.test.ts`, `system-settings.test.ts`.

- **Story B – “Keep a rich conversation going with the codebase”**
  - As a **developer using the conversation UI**, I can open a conversation, send multiple messages, and have the assistant remember and summarize context over time.
  - Flows:
    - UI uses `/conversations/api/*` and `/cursor/conversation/new` endpoints.
    - Conversation context is stored in Redis, summarized when too large, and stitched into subsequent prompts.
  - Key modules:
    - HTTP: conversation routes in `server.ts`.
    - Services: `conversation-service.ts`, `cursor-execution-service.ts` (context building + summarization), `request-formatter.ts`.
    - Redis resilience: `conversation-service.ts` (lazy connect, offline mode).
    - Tests: conversation‑related tests in `server.test.ts` plus any dedicated conversation tests (to be added) in the Python port.

- **Story C – “Review and refine code changes automatically”**
  - As a **developer**, I can run a review loop where a review agent inspects and refines changes produced by cursor CLI before they are surfaced or merged.
  - Flows:
    - Execution service calls into `review-agent-service` based on system instructions or flags.
    - Review agent uses conversation history and outputs review justifications.
  - Key modules:
    - Services: `review-agent-service.ts`, `cursor-execution-service.ts`, `conversation-service.ts`, `system-settings.ts` (feature flags / debug).
    - Tests: `review-agent-service.test.ts`, relevant tests in `cursor-cli.test.ts`, `system-settings.test.ts`.

- **Story D – “Manage agent conversations for integrations (e.g., ElevenLabs, other agents)”**
  - As an **integrated agent system**, I can create and manage agent‑specific conversations via a stable HTTP API.
  - Flows:
    - External agents call `/agent-conversations/api/*` to open conversations, add messages, and fetch history.
    - Agent conversations are stored separately from end‑user conversations but share Redis resilience behavior.
  - Key modules:
    - HTTP: agent conversation routes in `server.ts`.
    - Services: `agent-conversation-service.ts`, `conversation-service.ts` (shared patterns), `logger.ts`.
    - Tests: `agent-conversation-service.test.ts`, `agent-conversation-api.integration.test.ts`.

- **Story E – “Operate and observe the system safely in production”**
  - As an **operator/SRE**, I need clear health checks, queue visibility, and stable startup/shutdown behavior.
  - Flows:
    - Health UI/monitoring hits `/health` and `/health/queue`.
    - On container startup, migrations run and non‑critical failures are logged but do not crash the process; on shutdown, resources are released.
  - Key modules:
    - HTTP & lifecycle: `index.ts`, `server.ts`.
    - Execution & queue: `cursor-cli.ts` (semaphore, timeouts, queue status), `cursor-execution-service.ts`.
    - Migrations & DB: `migrations/cli.ts`, `migrations/migration-runner.ts`, `migrations/files/*.ts`, `task-service.ts`, `system-settings.ts`.
    - Tests: `index.test.ts`, `server.test.ts`, tests around migrations and tasks in the testing master plan.

- **Story F – “Configure features and integrations (MCP, Gmail, ElevenLabs)”**
  - As a **platform owner**, I can turn integrations on/off and verify configs without breaking core execution.
  - Flows:
    - System settings and feature flags control Gmail MCP, shared SQLite/Redis MCPs, ElevenLabs callbacks, and debug mode.
    - Invalid or missing configs are surfaced via logs and non‑fatal errors.
  - Key modules:
    - Config & flags: `system-settings.ts`, `utils/feature-flags.ts`.
    - MCP/Gmail helpers: code paths exercised by `mcp-config.test.ts`, `mcp-config-feature-flag.test.ts`, `test_gmail_integration.test.ts`, `system-settings-gmail-validation.test.ts`.
    - Tests: the MCP and Gmail test files plus `feature-flags.test.ts`.

---

### 3. Python Architecture & Project Layout

**3.1. Project structure (target)**

- `cursor-executor/`
  - `pyproject.toml` and/or `setup.cfg` (modern Python packaging).
  - `cursor_executor/` (main package)
    - `api/` (HTTP layer / FastAPI or Flask)
      - `server.py` (equivalent of `server.ts`)
      - `routers/` (for git, cursor, terminal, health, conversations)
    - `services/`
      - `cursor_cli.py`
      - `cursor_execution_service.py`
      - `git_service.py`
      - `filesystem_service.py`
      - `file_tree_service.py`
      - `terminal_service.py`
      - `agent_conversation_service.py`
      - `workspace_trust_service.py`
      - `github_auth.py`
      - `system_settings.py`
      - `logger.py` (or config for `logging` module)
      - `error_utils.py`
    - `models/`
      - Pydantic models (if using FastAPI) or dataclasses for request/response shapes.
    - `utils/`
      - Feature flags, shared helpers, string/path utilities.
  - `tests/`
    - Mirror `cursor-runner/tests` layout:
      - `test_cursor_cli.py`
      - `test_git_service.py`
      - `test_filesystem_service.py`
      - `test_terminal_service.py`
      - `test_server.py`
      - etc.
  - `scripts/`
    - `ci.sh`, `test.sh`, `format.sh`, to mirror Node scripts but using Python tooling.
  - `Dockerfile`, `docker-compose.override.example.yml` (Python version of the existing Docker setup).
  - `.env.example`, `.flake8` or `ruff.toml`, `pyproject.toml` (tooling).

**3.2. Framework & libraries**

- **Web framework**: Prefer **FastAPI** (async‑first, OpenAPI, easy validation) or Flask if simplicity is preferred.
- **HTTP models / validation**:
  - FastAPI + Pydantic models to express request/response schemas equivalent to the TS types.
- **Subprocess management**:
  - Use `asyncio.create_subprocess_exec` (for async) or `subprocess.run` with explicit timeouts for:
    - cursor CLI invocations,
    - git commands,
    - terminal commands.
- **Logging**:
  - Use Python’s `logging` with structured/contextual logging (JSON if needed) to match Node logger behavior.
- **Configuration**:
  - Load via `pydantic-settings` or a small custom loader reading environment variables (to match `.env` contract).

### 3.3. File‑by‑File Mapping Checklist (Aligned with `TO-DO.md`)

This section summarizes the concrete TypeScript files that must each gain a Python counterpart. See `TO-DO.md` for the authoritative lists.

- **Core services & HTTP**
  - Entry/server: `src/index.ts`, `src/server.ts`.
  - Execution: `src/cursor-cli.ts`, `src/cursor-execution-service.ts`, `src/request-formatter.ts`, `src/error-utils.ts`, `src/logger.ts`, `src/target-app.ts`, `src/workspace-trust-service.ts`.
  - Git & repositories: `src/git-service.ts`, `src/git-completion-checker.ts`, `src/github-auth.ts`.
  - Filesystem & workspace: `src/filesystem-service.ts`, `src/file-tree-service.ts`.
  - Terminal: `src/terminal-service.ts`.
  - Conversations & agents: `src/conversation-service.ts`, `src/agent-conversation-service.ts`, `src/review-agent-service.ts`, `src/callback-url-builder.ts`, `src/command-parser-service.ts`.
  - Config & tasks: `src/system-settings.ts`, `src/task-service.ts`, `src/utils/feature-flags.ts`.

- **Migrations & persistence**
  - Migration CLI & runner: `src/migrations/cli.ts`, `src/migrations/migration-runner.ts`.
  - Migration files:
    - `src/migrations/files/00000000000000_create_schema_migrations.ts`
    - `src/migrations/files/20250101000001_create_system_settings.ts`
    - `src/migrations/files/20250101000002_create_tasks.ts`
    - `src/migrations/files/20250101000003_create_git_credentials.ts`
    - `src/migrations/files/20250101000004_create_telegram_bots.ts`

- **Tests to mirror in pytest**
  - Core behavior:
    - `tests/index.test.ts`
    - `tests/server.test.ts`
    - `tests/cursor-cli.test.ts`
    - `tests/request-formatter.test.ts`
    - `tests/system-settings.test.ts`
    - `tests/system-settings-gmail-validation.test.ts`
    - `tests/feature-flags.test.ts`
    - `tests/file-tree-service.test.ts`
    - `tests/filesystem-service.test.ts`
    - `tests/git-service.test.ts`
    - `tests/terminal-service.test.ts`
    - `tests/review-agent-service.test.ts`
    - `tests/agent-conversation-service.test.ts`
    - `tests/agent-conversation-api.integration.test.ts`
    - `tests/test_gmail_integration.test.ts`
  - Shared helpers:
    - `tests/test-utils.ts`
    - `tests/helpers/test-helpers.ts`
  - MCP/Gmail config:
    - `tests/mcp-config.test.ts`
    - `tests/mcp-config-feature-flag.test.ts`

For each of the above, the Python plan is:

- A **service module** (e.g., `cursor_executor/services/git_service.py`) that encapsulates the behavior of the TS file.
- One or more **test modules** (e.g., `tests/test_git_service.py`) that port the Jest tests to `pytest` while preserving scenarios and edge cases.
- Updates to the **HTTP layer** (e.g., `cursor_executor/api/server.py` and routers) to expose equivalent endpoints.

---

### 4. Node.js → Python Semantics & Best Practices

**4.1. Async model**
- Node’s async/await and promises → Python’s `async def` and `await`, or synchronous if endpoints aren’t heavily concurrent.
- For long‑running CLI processes (cursor, git, terminal):
  - Use async subprocesses where beneficial.
  - Enforce timeouts with `asyncio.wait_for` or subprocess timeout parameters.

**4.2. Error handling**
- TypeScript pattern: `try/catch`, custom error classes, returning `{ success, error }`.
- Python pattern:
  - Define custom exception hierarchy (e.g., `CursorExecutorError`, `GitError`, `CursorCliError`, `ValidationError`).
  - Catch at appropriate boundaries and convert to:
    - HTTP responses with the same JSON shape as `cursor-runner` (status, success flag, error message, any additional context).
    - Internal error logs with stack traces and metadata.
  - Ensure all edge‑case errors present in TS tests are preserved (e.g., timeouts, invalid branches, missing repos, disallowed commands).

**4.3. Types and models**
- TS uses interfaces/types → Python will use:
  - Pydantic models for HTTP I/O, enforcing field presence and types.
  - `TypedDict` or dataclasses for internal data when appropriate.
  - Type hints everywhere; use `mypy` or `pyright` to maintain type safety.

**4.4. Configuration**
- Mirror env variable names used in `.env.example` and `system-settings.ts`:
  - `PORT`, `CURSOR_CLI_PATH`, `CURSOR_CLI_TIMEOUT`, `CURSOR_API_KEY`, `TARGET_APP_PATH`, `REPOSITORIES_PATH`, etc.
  - Provide default values identical to the Node implementation.
  - Implement strict validation for invalid or missing required settings, just as Node does (tests should confirm this).

**4.5. Security & safety**
- Re‑implement:
  - Command whitelisting/blacklisting for terminal and cursor CLI invocations.
  - Path normalization and root checks using `pathlib.Path.resolve()` to avoid directory traversal.
  - Output limiting by reading from subprocess streams in chunks and truncating beyond configured max size.
  - Timeouts using `asyncio` or `subprocess` arguments; ensure process termination and cleanup.
  - Git safety: sanitize branch names, restrict clones to allowable roots, validate remote URLs where applicable.

---

### 5. API Compatibility and Contract Preservation

**5.1. HTTP endpoints**
Replicate all public endpoints from `cursor-runner`:

- `GET /health`
- `POST /cursor/execute`
- `POST /cursor/execute/async`
- `POST /git/clone`
- `GET /git/repositories`
- `POST /git/checkout`
- `POST /git/push`
- `POST /git/pull`
- Any agent conversation or additional routes exposed in `server.ts` or related files.

For each endpoint:

- **Request body**: match the field names (`camelCase` or `snake_case`) and semantics expected by existing clients (e.g., `jarek-va`, telegram receiver, ElevenLabs agent).
- **Response body**: preserve the shape (`{ success, error, data?, ... }`) and HTTP status codes.
- **Error mapping**: ensure identical (or compatible) status codes and error messages for known failure scenarios (e.g., unknown repository, git failure, timeout).

**5.2. Integration with `jarek-va`**

- Confirm usage patterns in `jarek-va` (controllers and services that talk to cursor-runner).
- Ensure:
  - Base URL and path structure stay the same, or provide a simple config switch.
  - JSON fields and semantics are unchanged.
  - Timeouts and retry behaviors remain safe (no surprising long blocking).

---

### 6. Testing Strategy and TDD Workflow

**6.1. Port existing Jest tests to Python**

- Mirror each Jest test file in `tests/` into:
  - `tests/test_<module>.py` using `pytest`.
- Preserve:
  - The scenarios tested (happy path, error cases, timeouts, path validation, command blacklisting, etc.).
  - Any mocked behavior (e.g., mocking CLI calls, git operations, filesystem).
  - Any snapshot‑like validations (convert to explicit assertions).

**6.2. Python testing stack**

- **Framework**: `pytest`.
- **Mocking**: `unittest.mock` or `pytest` fixtures.
- **Coverage**: `coverage.py` or `pytest-cov` with minimum thresholds similar to the Jest setup.
- **CI script**:
  - `pytest --maxfail=1 --disable-warnings -q`
  - `pytest --cov=cursor_executor --cov-report=term-missing`

**6.3. TDD workflow support**

- Implement the same phases: `red`, `green`, `refactor`, `validate` in the Python `cursor_execution_service`.
- Ensure:
  - Python API accepts the same `phase` values and request structure.
  - Behavior (e.g., generating tests vs implementation, refactor commands) maps 1:1 with Node version.

---

### 7. Detailed Migration Steps

**Step 1 – Baseline documentation and contracts**
- Extract and summarize:
  - All HTTP routes and schemas from `server.ts` and `tests/server.test.ts`.
  - All service method signatures (cursor, git, filesystem, terminal, conversations).
  - All environment variables and defaults from `system-settings.ts` and `.env.example`.

**Step 2 – Set up Python project skeleton**
- Create `cursor-executor` with:
  - `pyproject.toml` (Poetry or PEP 621 metadata).
  - Basic package `cursor_executor/` and `tests/`.
  - FastAPI or Flask server with a simple `/health` endpoint.
  - Logging and configuration stubs.

**Step 3 – Implement configuration and logging**
- Implement `system_settings.py`:
  - Load env vars, set defaults, validate required values.
  - Provide a centralized settings object used across services.
- Implement `logger.py`:
  - Structured logging similar to Node version.
  - Request/response logging hooks as needed.

**Step 4 – Implement cursor CLI service**
- Port `cursor-cli.ts` and `cursor-execution-service.ts`:
  - Support synchronous and async execution.
  - Enforce timeouts and output size limits.
  - Wrap subprocess results into standardized response objects.
  - Map cursor CLI exit codes and stderr into rich error messages.

**Step 5 – Implement filesystem and workspace trust services**
- Port `filesystem-service.ts`, `file-tree-service.ts`, `workspace-trust-service.ts`:
  - Implement safe read/write operations with path validation (`pathlib`).
  - Implement file tree generation (directory walking with filters).
  - Reproduce workspace trust rules and their edge cases.

**Step 6 – Implement git service**
- Port `git-service.ts`, `git-completion-checker.ts`, `github-auth.ts`:
  - Implement wrappers around `git` commands with timeouts.
  - Preserve behavior for:
    - Cloning different URL types.
    - Checking branch existence, fast‑forwards, conflicts.
    - Handling auth via env variables (tokens, usernames).
  - Mirror all error and edge‑case logic found in tests.

**Step 7 – Implement terminal service**
- Port `terminal-service.ts`:
  - Implement command whitelisting/blacklisting.
  - Manage subprocess stdin/stdout/stderr with size limits.
  - Handle timeouts and process cleanup.

**Step 8 – Implement agent and conversation services**
- Port `agent-conversation-service.ts` and related APIs:
  - Ensure contracts match any external integrations (e.g., ElevenLabs agent).

**Step 9 – Implement HTTP API layer**
- Build routers/controllers that:
  - Call into the Python services.
  - Translate inputs/outputs to the same JSON shapes as `cursor-runner`.
  - Centralize error handling and mapping to HTTP status codes.

**Step 10 – Testing and CI**
- Port Jest tests to `pytest`.
- Add new tests for any Python‑specific behavior.
- Set up GitHub Actions or local CI scripts:
  - Lint (`ruff`, `flake8` or `pylint`).
  - Format (`black`).
  - Type check (`mypy` or `pyright`).
  - Run tests with coverage.

**Step 11 – Docker and deployment**
- Create a Python `Dockerfile` mirroring `cursor-runner`’s deployment:
  - Install Python + dependencies.
  - Copy code and run `pytest` in build stage (optional).
  - Run with `uvicorn` or `gunicorn` for FastAPI/Flask.
- Adjust `docker-compose.yml` (or provide new one) to:
  - Mount the same volumes (repositories, logs, shared DB).
  - Expose the same port as `cursor-runner` (e.g., 3001) or a clearly documented alternative.

**Step 12 – Integration and rollout**
- Run the existing integration flows (via `jarek-va`, telegram receiver, etc.) against `cursor-executor`.
- Gradually replace calls from `cursor-runner` to `cursor-executor`:
  - Start with non‑production / test environments.
  - Compare behavior on real tasks and TDD workflows.
- Capture any behavioral differences and either:
  - Fix Python implementation to match Node, or
  - Intentionally document and codify the new behavior.

---

### 8. Edge‑Case Parity Checklist

For each of the following, confirm **equivalent behavior** between Node and Python implementations (via tests and manual checks where appropriate):

- **Cursor CLI**
  - Timeouts and cleanup on long‑running commands.
  - Handling of non‑zero exit codes and stderr output.
  - Large output truncation and logging behavior.
  - Invalid configuration (missing API key, invalid CLI path).
- **Git**
  - Invalid repository URLs.
  - Network errors and auth failures.
  - Non‑existent branches.
  - Merge conflicts / unclean trees on checkout, pull, push.
  - Handling of bare vs working repos, detached HEAD states.
- **Filesystem**
  - Attempts to escape allowed directories (`..`, symlinks).
  - Non‑existent paths.
  - Permission errors.
  - Very large directories / deep nesting.
- **Terminal**
  - Disallowed commands (blacklist enforcement).
  - Commands that hang or spam output.
  - Interactive commands (should be rejected or safely handled).
- **API**
  - Missing or malformed request bodies.
  - Unknown routes.
  - Internal server errors (500) with safe, non‑leaky error messages.

Maintain this checklist as a living document and tick off each category as we achieve parity.

---

### 9. Documentation and Developer Experience

- Keep `README.md` for `cursor-executor` aligned with `cursor-runner`’s README:
  - Overview, architecture, prerequisites, installation, configuration, usage, API endpoints, TDD workflow, security, troubleshooting.
- Add migration notes:
  - Differences between Node and Python implementations (only where necessary).
  - Any new Python tools or commands developers need (`poetry`, `pipx`, `ruff`, `black`, etc.).
- Provide **quickstart** steps for:
  - Running locally with `uvicorn`/`gunicorn`.
  - Running tests and CI checks.
  - Running in Docker alongside `jarek-va` and other services.

---

### 10. Success Criteria

`cursor-executor` is considered a successful port when:

- It passes an equivalent (or stricter) test suite compared to `cursor-runner`.
- All documented features and endpoints behave identically (or with documented, intentional differences).
- All major edge cases handled by `cursor-runner` are verified and preserved.
- It can be swapped in for `cursor-runner` in the Virtual Assistant stack without breaking existing flows.


