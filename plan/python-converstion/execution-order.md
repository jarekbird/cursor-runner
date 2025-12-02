### Cursor Executor Python Port – Execution Order

This file breaks the master plan into an ordered sequence of granular tasks that an AI agent can execute iteratively with automated tests.

---

## TASK-PY-001: Confirm Baseline `cursor-runner` State

### Implementation Steps
- [ ] In the Node `cursor-runner` repo, run `npm install` (if needed) and `npm test` to ensure all tests are passing.
- [ ] Verify there are no uncommitted changes in `VirtualAssistant/cursor-runner`, `assistant-integrations/cursor-runner`, and `python-cursor/cursor-runner` (or document any intentional local differences).
- [ ] Capture the current commit SHA and note it in a short baseline note in the `python-converstion` plan folder.
- [ ] Skim `server.ts`, `cursor-execution-service.ts`, `cursor-cli.ts`, `conversation-service.ts`, and `system-settings.ts` to confirm they match the assumptions in `master-plan.md`.

### Testing
- [ ] `npm test` passes in the canonical Node repo.

### Definition of Done
- [ ] Baseline commit SHA is recorded.
- [ ] Node tests are green, establishing a stable reference behavior for the Python port.

---

## TASK-PY-002: Create Python Project Skeleton

### Implementation Steps
- [ ] Create `cursor-executor/` (or equivalent) with:
  - [ ] `pyproject.toml` defining dependencies (FastAPI/Flask, pydantic, redis, pytest, etc.).
  - [ ] Package root `cursor_executor/` with empty subpackages: `api/`, `services/`, `models/`, `utils/`.
  - [ ] `tests/` folder mirroring the Node test layout (names only for now).
- [ ] Implement a minimal FastAPI (or Flask) app in `cursor_executor/api/server.py` with:
  - [ ] `/health` endpoint returning `{ "status": "ok", "service": "cursor-executor" }`.
  - [ ] Basic logging of IP and user-agent.
- [ ] Add basic dev tooling:
  - [ ] `pytest` config.
  - [ ] Formatter (e.g., `black`) config.
  - [ ] Linter (e.g., `ruff` or `flake8`) config.

### Testing
- [ ] Add `tests/test_health_endpoint.py` that:
  - [ ] Spins up the app via a test client and asserts the `/health` response (status and body).
- [ ] Run `pytest` and ensure tests pass.

### Definition of Done
- [ ] Python project skeleton exists with a working `/health` endpoint and a passing test.

---

## TASK-PY-003: Implement Configuration & Settings Module

### Implementation Steps
- [ ] Create `cursor_executor/services/system_settings.py` (or similar) that:
  - [ ] Mirrors env vars from Node `.env.example` and `system-settings.ts` (e.g., `PORT`, `CURSOR_CLI_PATH`, `CURSOR_CLI_TIMEOUT`, `CURSOR_CLI_MAX_CONCURRENT`, `CURSOR_CLI_MAX_OUTPUT_SIZE`, `CURSOR_CLI_IDLE_TIMEOUT`, `TARGET_APP_PATH`, `REPOSITORIES_PATH`, `REDIS_URL`, `SHARED_DB_PATH`, Gmail MCP flags, ElevenLabs flags, etc.).
  - [ ] Uses `pydantic-settings` (or equivalent) to provide typed settings with defaults that match Node behavior.
  - [ ] Validates required values and raises clear errors when critical configuration is missing/invalid.
- [ ] Expose a singleton or dependency-injection-friendly settings object for use in all services.
- [ ] Document env vars and defaults in the Python README.

### Testing
- [ ] Add `tests/test_system_settings.py` that:
  - [ ] Verifies defaults when only minimal env is set.
  - [ ] Asserts that invalid/missing critical env values fail fast with clear messages.

### Definition of Done
- [ ] Settings module provides all required configuration with defaults aligned to Node.
- [ ] Tests cover both happy path and error cases for configuration.

---

## TASK-PY-004: Implement Structured Logging

### Implementation Steps
- [ ] Implement `cursor_executor/services/logger.py` that:
  - [ ] Configures `logging` with JSON or key-value output (level, timestamp, message, service, requestId, queueType, repository).
  - [ ] Respects a `LOG_LEVEL` env var.
- [ ] Provide helper functions to attach context (e.g., requestId, conversationId) to log entries.
- [ ] Replace any initial `print` statements in Python code with structured logger calls.

### Testing
- [ ] Add `tests/test_logger.py` that:
  - [ ] Captures a sample log record and asserts required fields are present.
  - [ ] Verifies log level can be adjusted via env.

### Definition of Done
- [ ] All modules use the shared logger.
- [ ] Logging format and fields are consistent and suitable for production monitoring.

---

## TASK-PY-005: Implement SQLite Migration Framework

### Implementation Steps
- [ ] Create `cursor_executor/migrations/` containing:
  - [ ] A migration runner abstraction (Python equivalent of `src/migrations/migration-runner.ts`).
  - [ ] A CLI entry (e.g., `cursor_executor/migrations/cli.py`) that supports `migrate`, `rollback`, `status`.
- [ ] Port migration files:
  - [ ] Create Python migrations that mirror:
    - Schema migrations table.
    - System settings table.
    - Tasks table.
    - Git credentials table.
    - Telegram bots table.
- [ ] Design migrations to be idempotent and safe on repeated runs.

### Testing
- [ ] Add `tests/test_migrations.py` that:
  - [ ] Creates a temp SQLite DB.
  - [ ] Runs migrations twice and verifies:
    - Schema is correct.
    - No errors on the second run.

### Definition of Done
- [ ] Migration CLI can create and update the SQLite schema equivalent to Node’s.
- [ ] Migrations are idempotent and covered by tests.

---

## TASK-PY-006: Implement System Settings & Task Services (SQLite)

### Implementation Steps
- [ ] Implement `cursor_executor/services/system_settings_service.py` (or similar) to:
  - [ ] Read/write system settings in SQLite using the migrated schema.
  - [ ] Provide `is_system_setting_enabled` with env-based fallback for debug flags.
- [ ] Implement `cursor_executor/services/task_service.py` mirroring Node’s `task-service.ts`:
  - [ ] CRUD for tasks, including status filtering and ordering rules.
  - [ ] Consistent status labels and timestamp handling.

### Testing
- [ ] Add `tests/test_system_settings_service.py` and `tests/test_task_service.py` covering:
  - [ ] Creating, updating, reading, deleting settings and tasks.
  - [ ] Behavior when DB is unavailable or misconfigured.

### Definition of Done
- [ ] System settings and task services behave equivalently to Node’s, per tests.

---

## TASK-PY-007: Implement Filesystem & File Tree Services

### Implementation Steps
- [ ] Implement `cursor_executor/services/filesystem_service.py`:
  - [ ] Safe read/write helpers using `pathlib.Path.resolve()` and repository root constraints.
  - [ ] Clear error handling for non-existent paths, permission errors, and traversal attempts.
- [ ] Implement `cursor_executor/services/file_tree_service.py`:
  - [ ] Directory walking with ignore rules (mirroring Node behavior as much as feasible).
  - [ ] Sorted output (directories first, then files).

### Testing
- [ ] Add `tests/test_filesystem_service.py` and `tests/test_file_tree_service.py` mirroring Node tests.

### Definition of Done
- [ ] Filesystem and file tree behaviors (including edge cases) are covered by tests and match Node expectations.

---

## TASK-PY-008: Implement Workspace Trust Service

### Implementation Steps
- [ ] Implement `cursor_executor/services/workspace_trust_service.py`:
  - [ ] Enforce allowed roots for repositories and target apps.
  - [ ] Provide checks similar to Node’s `workspace-trust-service.ts`.
- [ ] Integrate workspace trust checks into filesystem, git, and cursor-execution flows where appropriate.

### Testing
- [ ] Add `tests/test_workspace_trust_service.py` covering:
  - [ ] Allowed vs disallowed paths.
  - [ ] Behavior when trust configuration is missing or invalid.

### Definition of Done
- [ ] Workspace trust is enforced consistently in Python, with tests demonstrating security behavior.

---

## TASK-PY-009: Implement Git Services (Git, Completion, GitHub Auth)

### Implementation Steps
- [ ] Implement `cursor_executor/services/git_service.py`:
  - [ ] Wrap `git` operations (clone, checkout, pull, push, list repos) with timeouts and logging.
- [ ] Implement `cursor_executor/services/git_completion_checker.py` equivalent to `git-completion-checker.ts`.
- [ ] Implement `cursor_executor/services/github_auth.py` to bootstrap non-interactive git config (tokens, SSH, etc.).

### Testing
- [ ] Add `tests/test_git_service.py` and related tests:
  - [ ] Use temp repos and/or mocks to simulate:
    - Invalid URLs.
    - Non-existent branches.
    - Merge conflicts.
  - [ ] Verify completion logic and error mapping.

### Definition of Done
- [ ] Git operations and completion checks behave like Node’s, with tests covering success and failure modes.

---

## TASK-PY-010: Implement Cursor CLI Wrapper (Execution Semantics)

### Implementation Steps
- [ ] Finish `cursor_executor/services/cursor_cli.py` with:
  - [ ] Concurrency semaphore mirroring `CURSOR_CLI_MAX_CONCURRENT`.
  - [ ] Main timeout and idle timeout behavior.
  - [ ] Safety timeout that guarantees semaphore release on edge cases.
  - [ ] Output-size caps.
  - [ ] Optional PTY-like behavior (if practical) for dealing with interactive prompts, or documented alternative.

### Testing
- [ ] Expand `tests/test_cursor_cli.py`:
  - [ ] Simulate long-running commands, idle commands, output floods.
  - [ ] Assert semaphore is always released.

### Definition of Done
- [ ] Python cursor CLI wrapper can reproduce Node’s timeout and concurrency behavior, per tests.

---

## TASK-PY-011: Implement Conversation Service (Redis, Context, Summarization)

### Implementation Steps
- [ ] Implement `cursor_executor/services/conversation_service.py`:
  - [ ] Manage conversations in Redis keyed by queue type (`default`, `telegram`, `api`).
  - [ ] Implement `get_conversation_id`, `create_conversation`, `add_message`, `get_conversation_context`, and summarization logic.
  - [ ] Implement graceful degradation when Redis is unavailable (generate new IDs, log warnings, stop persisting).
- [ ] Implement summarization behavior:
  - [ ] Detect context-window errors from output (based on patterns defined in Node).
  - [ ] Compress conversation history into a summary + recent messages and persist as summarized context.

### Testing
- [ ] Add `tests/test_conversation_service.py`:
  - [ ] Use an in-memory or mocked Redis client.
  - [ ] Cover normal, Redis-down, and summarization error cases.

### Definition of Done
- [ ] Conversation service behavior (including summarization and degradation) is parity-checked against Node via tests.

---

## TASK-PY-012: Implement Agent Conversation Service (Redis)

### Implementation Steps
- [ ] Implement `cursor_executor/services/agent_conversation_service.py` mirroring Node’s:
  - [ ] Create, list, get, and update agent conversations with pagination and sorting.
  - [ ] Store status fields (`active`, `completed`, `archived`, `failed`).
- [ ] Share Redis resilience patterns with the main conversation service.

### Testing
- [ ] Add `tests/test_agent_conversation_service.py` and `tests/test_agent_conversation_api_integration.py`:
  - [ ] Cover listing, pagination, sorting, and failure modes (Redis down).

### Definition of Done
- [ ] Agent conversation service mirrors Node behavior with tests covering primary flows and edge cases.

---

## TASK-PY-013: Implement Cursor Execution Service (Execute / Iterate)

### Implementation Steps
- [ ] Implement `cursor_executor/services/cursor_execution_service.py`:
  - [ ] `execute` method that prepares prompts, attaches system instructions, validates repositories/workspace trust, invokes `CursorCLI`, and records conversation context.
  - [ ] `iterate` method that:
    - [ ] Loops up to `maxIterations`.
    - [ ] Logs memory usage.
    - [ ] Handles partial output on errors and updates conversation.
    - [ ] Triggers summarization on context-window errors.
  - [ ] Callback webhook logic for async flows (building payloads, handling errors without crashing workers).

### Testing
- [ ] Add `tests/test_cursor_execution_service.py` with extensive mocks of `CursorCLI`, git, filesystem, workspace trust, and conversation services.

### Definition of Done
- [ ] Execution flows (sync and async) match Node semantics, with tests covering success, failures, and context-window behavior.

---

## TASK-PY-014: Implement HTTP API Layer (Routes and Contracts)

### Implementation Steps
- [ ] In `cursor_executor/api/server.py` (and routers), implement endpoints equivalent to Node:
  - [ ] `/health`, `/health/queue`.
  - [ ] `/cursor/execute`, `/cursor/execute/async`.
  - [ ] `/cursor/iterate`, `/cursor/iterate/async`.
  - [ ] `/cursor/conversation/new`.
  - [ ] `/conversations/api/*` (list, new, get, add message).
  - [ ] `/agent-conversations/api/*` (list, new, get, add message).
  - [ ] `/repositories/api/:repository/files`.
  - [ ] Any tasks and Telegram webhook routes that need parity.
- [ ] Map HTTP request/response shapes and status codes exactly to Node, using Pydantic models.

### Testing
- [ ] Add `tests/test_server.py`:
  - [ ] Unit/integration tests for each endpoint, using mocked services where needed.

### Definition of Done
- [ ] All public HTTP endpoints exist in Python with contracts matching Node’s, and tests verify core behaviors.

---

## TASK-PY-015: Implement Feature Flags and MCP/Gmail Integration Hooks

### Implementation Steps
- [ ] Implement `cursor_executor/utils/feature_flags.py` mirroring Node feature flags.
- [ ] Implement Gmail/MCP-related helpers and configuration checks analogous to:
  - [ ] `mcp-config.test.ts`.
  - [ ] `mcp-config-feature-flag.test.ts`.
  - [ ] `test_gmail_integration.test.ts`.
  - [ ] `system-settings-gmail-validation.test.ts`.

### Testing
- [ ] Port the Node tests for MCP/Gmail config into Python tests.

### Definition of Done
- [ ] Feature flags and MCP/Gmail config handling behave identically to Node, per tests.

---

## TASK-PY-016: End-to-End Lite Flows & Edge-Case Parity

### Implementation Steps
- [ ] Add E2E-lite tests (Python side) that:
  - [ ] Hit async iterate flows and verify callback behavior.
  - [ ] Exercise conversation and agent-conversation flows end-to-end (API → services → Redis/SQLite).
  - [ ] Exercise error paths (unknown repos, bad requests, internal errors) and verify response shapes.
- [ ] Compare behaviors and logs with Node for a small set of canonical scenarios.

### Testing
- [ ] Add tests under `tests/test_e2e_*` using a test app and temporary DBs.

### Definition of Done
- [ ] Key workflows and edge cases behave equivalently between Node and Python, demonstrated by passing E2E-lite tests.

---

## TASK-PY-017: Docker, Compose, and CI Integration

### Implementation Steps
- [ ] Create a Python `Dockerfile` for `cursor-executor`:
  - [ ] Install dependencies, copy code, run tests at build (optional).
- [ ] Update or create `docker-compose` files to:
  - [ ] Run Python service with Redis and SQLite volumes matching Node deployment.
- [ ] Add CI workflows or scripts to:
  - [ ] Run linters and formatters.
  - [ ] Run type checks.
  - [ ] Run `pytest` with coverage.

### Testing
- [ ] Build and run the Docker image locally; hit `/health` and a few core endpoints.
- [ ] Run CI pipeline locally or in GitHub to ensure all checks pass.

### Definition of Done
- [ ] Python service can be built and run in containers alongside existing stack.
- [ ] CI reliably validates code quality and tests.

---

## TASK-PY-018: Integration with `jarek-va` and Rollout

### Implementation Steps
- [ ] Identify all places where `jarek-va` calls `cursor-runner` and make the base URL configurable.
- [ ] Introduce a flag or environment switch to route traffic to `cursor-executor` instead of Node for test/staging.
- [ ] Run real-world tasks through `cursor-executor` and compare results with Node:
  - [ ] At least one complex feature task.
  - [ ] At least one review-agent flow.

### Testing
- [ ] Add integration tests or scripts in `jarek-va` that can target Python or Node backends.

### Definition of Done
- [ ] `cursor-executor` can be used as a drop-in replacement for `cursor-runner` in non-production environments.
- [ ] A clear path is documented for moving production traffic over once confidence is high.


