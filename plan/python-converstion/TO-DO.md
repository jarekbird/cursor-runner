### Python Port of `cursor-runner` – High-Level TODO

This TODO tracks **everything needed** to build a Python version of the `cursor-runner` application (HTTP API, services, persistence, and tests).

---

### 1. Dependencies & Environment

- **Runtime & tooling**
  - Python 3.11+ installed (align with rest of `python-cursor` repo).
  - Package manager: `pip` or `poetry` (decide and configure).
  - Node `cursor` CLI installed and available on PATH (or configured via env).
- **Python libraries (initial target set)**
  - Web framework: **FastAPI** (or Flask) for HTTP API parity with Express.
  - ASGI server: **uvicorn** (or gunicorn + uvicorn workers) for production.
  - Validation & models: **pydantic** (for request/response schemas).
  - SQLite: either:
    - stdlib `sqlite3` + thin DAOs, or
    - **SQLAlchemy** for higher-level ORM (with migrations handled separately).
  - Redis client: **redis-py** (async if using async endpoints).
  - Logging: stdlib `logging` with JSON/structured handlers (or `loguru`).
  - Environment/config: `pydantic-settings` or similar for env var loading.
  - Testing: `pytest`, `pytest-asyncio`, `pytest-cov`.
  - HTTP client: `httpx` or `requests` (for callbacks and webhooks).
- **External services & infra**
  - **Redis** instance for conversation and agent conversation storage.
  - **SQLite** database file for system settings, tasks, git credentials, etc.
  - **Docker** setup (optional but recommended) to mirror current deployment:
    - Container for Python service.
    - Shared volumes for repositories and shared DB.
    - Networked Redis and any MCP servers as needed.

---

### 2. Files/Modules to Port – Core `src/` Services

Each TypeScript file in `src/` needs a corresponding Python module with equivalent behavior and contracts.

- **Entry & HTTP server**
  - `src/index.ts` → Python entrypoint module (app startup, config validation, logging, migrations, server start/stop).
  - `src/server.ts` → HTTP router(s) and FastAPI/Flask app definition.
- **Cursor CLI & execution orchestration**
  - `src/cursor-cli.ts` → Python wrapper for `cursor` CLI:
    - Subprocess execution (PTY vs non-PTY), timeouts, output-size caps, concurrency limits.
  - `src/cursor-execution-service.ts` → High-level execution/iteration orchestration:
    - Building commands, attaching system instructions, handling callbacks, context-window summarization, and iteration loops.
- **Git & repository management**
  - `src/git-service.ts` → Python git service (clone, checkout, push, pull, repo path management).
  - `src/git-completion-checker.ts` → Logic for verifying git completion / definition-of-done behavior.
  - `src/github-auth.ts` → GitHub auth bootstrap and non-interactive git config.
- **Filesystem & workspace**
  - `src/filesystem-service.ts` → Safe filesystem abstraction with path validation.
  - `src/file-tree-service.ts` → File tree building with ignore rules and sorting.
  - `src/workspace-trust-service.ts` → Workspace trust model and safeguards.
  - `src/target-app.ts` → Target app configuration, working directory resolution, and related helpers.
- **Terminal & process execution**
  - `src/terminal-service.ts` → Generic terminal command execution with whitelists/blacklists, timeouts, and output limits.
- **Conversations & agents**
  - `src/conversation-service.ts` → Conversation storage in Redis, summarization, context building, queue-type aware last-conversation behavior.
  - `src/agent-conversation-service.ts` → Agent conversation storage, listing, pagination, status fields.
  - `src/review-agent-service.ts` → Review agent orchestration and integration with cursor execution.
  - `src/callback-url-builder.ts` → Callback URL construction logic (JAREK_VA_URL, fallbacks, etc.).
  - `src/command-parser-service.ts` → Parsing and augmenting cursor CLI command arguments.
- **Config, settings, and system behavior**
  - `src/system-settings.ts` → System settings backed by SQLite, feature toggles, and MCP-related settings.
  - `src/task-service.ts` → Tasks table model and CRUD (tasks API behavior).
  - `src/utils/feature-flags.ts` → Feature flag helpers (e.g., ElevenLabs, Gmail MCP, etc.).
- **Logging, errors, and formatting**
  - `src/logger.ts` → Structured logging configuration and helpers.
  - `src/error-utils.ts` → Error shaping, HTTP status mapping, and safe error messages.
  - `src/request-formatter.ts` → TDD/system instruction formatting, request/response helpers.

---

### 3. Migrations & Persistence Files to Mirror

These TypeScript files define database schema and migration flows; the Python port needs equivalent migration handling.

- `src/migrations/cli.ts` → Python migration CLI (invoke migrations, rollback, status).
- `src/migrations/migration-runner.ts` → Core migration runner abstraction.
- `src/migrations/files/00000000000000_create_schema_migrations.ts` → Schema migrations table.
- `src/migrations/files/20250101000001_create_system_settings.ts` → System settings schema.
- `src/migrations/files/20250101000002_create_tasks.ts` → Tasks table schema.
- `src/migrations/files/20250101000003_create_git_credentials.ts` → Git credentials schema.
- `src/migrations/files/20250101000004_create_telegram_bots.ts` → Telegram bots schema.

Python equivalent:
- Define a migrations directory (e.g., `cursor_executor/migrations/`) with:
  - Python migration scripts mirroring each of the above.
  - A small migration framework (custom or based on Alembic) to apply them idempotently.

---

### 4. Test Suite to Port (from `tests/`)

Each Jest test file should be mirrored by an equivalent `pytest` test module.

- Core tests:
  - `tests/index.test.ts`
  - `tests/server.test.ts`
  - `tests/cursor-cli.test.ts`
  - `tests/callback-url-builder.test.ts`
  - `tests/command-parser-service.test.ts`
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
- MCP/Gmail specific:
  - `tests/mcp-config.test.ts`
  - `tests/mcp-config-feature-flag.test.ts`

Python equivalent:
- Create `tests/` under the Python project with:
  - `test_server.py`, `test_cursor_cli.py`, `test_git_service.py`, etc., mapping 1:1 to the above.
  - Test helpers for:
    - Creating app instances with mocked dependencies.
    - Temp SQLite databases and Redis mocks.
    - Shared assertions for responses and logs.

---

### 5. Initial Setup Tasks (Python Project)

- **Project skeleton**
  - Create Python package (e.g., `cursor_executor/`) with:
    - `__init__.py`
    - `api/` (HTTP layer: routers/endpoints for health, cursor, git, conversations, tasks).
    - `services/` (cursor CLI, execution, git, filesystem, terminal, conversations, agents, system settings).
    - `models/` (Pydantic or dataclass models for requests/responses).
    - `config/` or `settings.py` (env-driven configuration).
  - Add `pyproject.toml` (or `setup.cfg` + `requirements.txt`) defining dependencies.
- **Testing & tooling**
  - Configure `pytest` (and `pytest-asyncio` if using async endpoints).
  - Add `pytest-cov` and coverage thresholds.
  - Add formatter (`black`) and linter (`ruff` or `flake8`).
  - Optionally configure `mypy` or `pyright` for static type checking.
- **Server bootstrap**
  - Implement a minimal health endpoint (`GET /health`) with:
    - Status structure matching Node `cursor-runner`.
    - Logging of IP, user-agent.
  - Wire up startup/shutdown hooks:
    - Load settings, initialize DB and Redis connections (with the same resilience behaviors).
    - Run migrations on startup (or expose a separate CLI for migrations).
- **Configuration & env parity**
  - Mirror key env vars:
    - `PORT`, `CURSOR_CLI_PATH`, `CURSOR_CLI_TIMEOUT`, `CURSOR_CLI_MAX_CONCURRENT`, `CURSOR_CLI_MAX_OUTPUT_SIZE`, `CURSOR_CLI_IDLE_TIMEOUT`.
    - `REDIS_URL`, `SHARED_DB_PATH`, `ENABLE_GMAIL_MCP`, Gmail credentials, feature flags, etc.
  - Provide `.env.example` (Python-focused) aligned with the Node version’s expectations.
- **Docker & CI**
  - Create a Python `Dockerfile` and `docker-compose` overrides that:
    - Use the same ports and volumes as the Node service where possible.
    - Connect to shared Redis and SQLite locations.
  - Add CI scripts:
    - Lint + format check.
    - Type check.
    - Tests with coverage.

---

### 6. Mapping & Tracking

- [ ] Confirm that every `src/*.ts` file has a Python counterpart planned.
- [ ] Confirm that every `tests/*.test.ts` file has a Python test counterpart planned.
- [ ] Keep this TODO in sync as new features/files are added to `cursor-runner`.


