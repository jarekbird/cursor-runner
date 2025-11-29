# Current State: MCP Configuration and Email Integration

This document captures the current state of MCP (Model Context Protocol) configuration and email-related capabilities in the `cursor-runner` system. This inventory serves as a baseline for adding Gmail MCP support.

**Date**: 2024-12-19  
**Task**: TASK-EML-001

---

## 1. MCP Configuration

### 1.1 MCP Configuration File Location

**Primary Config File**: `cursor-runner/mcp.json`

This file defines MCP servers available to cursor CLI. The file is located at the repository root.

**Reference**: `cursor-runner/mcp.json` (lines 1-20)

### 1.2 MCP Configuration Structure

The `mcp.json` file follows this structure:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "command-name",
      "args": ["arg1", "arg2"],
      "env": {
        "ENV_VAR_NAME": "value"
      }
    }
  }
}
```

### 1.3 Existing MCP Servers

Currently, three MCP servers are configured:

#### 1.3.1 `cursor-runner-shared-sqlite`

- **Command**: `mcp-server-sqlite-npx`
- **Args**: `["/app/shared_db/shared.sqlite3"]`
- **Purpose**: Provides SQLite database access via MCP
- **Environment Variables**: None (uses args for database path)
- **Reference**: `cursor-runner/mcp.json` (lines 3-7)

#### 1.3.2 `cursor-runner-shared-redis`

- **Command**: `npx`
- **Args**: `["-y", "@liangshanli/mcp-server-redis", "--url", "redis://redis:6379/0"]`
- **Purpose**: Provides Redis access via MCP
- **Package**: `@liangshanli/mcp-server-redis` (installed globally in Dockerfile)
- **Note**: Using `@liangshanli/mcp-server-redis` as the official `@modelcontextprotocol/server-redis` doesn't exist yet
- **Environment Variables**: 
  - `REDIS_URL`: `redis://redis:6379/0`
- **Reference**: `cursor-runner/mcp.json` (lines 9-20)

#### 1.3.3 `gmail`

- **Command**: `mcp-server-gmail`
- **Args**: `[]`
- **Purpose**: Provides Gmail access via MCP
- **Environment Variables**: 
  - `GMAIL_CLIENT_ID`: `${GMAIL_CLIENT_ID}` (env var reference)
  - `GMAIL_CLIENT_SECRET`: `${GMAIL_CLIENT_SECRET}` (env var reference)
  - `GMAIL_REFRESH_TOKEN`: `${GMAIL_REFRESH_TOKEN}` (env var reference)
  - `GMAIL_USER_EMAIL`: `${GMAIL_USER_EMAIL}` (env var reference, optional)
  - `GMAIL_ALLOWED_LABELS`: `${GMAIL_ALLOWED_LABELS}` (env var reference, optional)
- **Reference**: `cursor-runner/mcp.json` (lines 19-29)
- **Status**: Configured in `mcp.json`, but requires environment variables to be set for full functionality

### 1.4 MCP Configuration Loading Mechanism

The MCP configuration is loaded and merged through the following process:

1. **Source Config**: `cursor-runner/mcp.json` (in repository root)
2. **Merge Script**: `merge-mcp-config.js` (runs at Docker container startup)
3. **Target Locations**:
   - `/cursor/repositories/mcp.json` (merged config in Docker volume)
   - `/root/.cursor/mcp.json` (final config used by cursor-cli in container)

**Process Flow**:
1. Docker entrypoint script (`docker-entrypoint.sh`) runs `merge-mcp-config.js` on startup
2. `merge-mcp-config.js` merges `cursor-runner/mcp.json` with any existing config in `/cursor/repositories/mcp.json`
3. Merged config is written to `/cursor/repositories/mcp.json` and copied to `/root/.cursor/mcp.json`
4. cursor-cli reads MCP config from `/root/.cursor/mcp.json`

**References**:
- `cursor-runner/docker-entrypoint.sh` (lines 4-13)
- `cursor-runner/merge-mcp-config.js` (entire file)
- `cursor-runner/Dockerfile` (line 97 - entrypoint)

### 1.5 MCP Server Installation

MCP servers are installed globally in the Docker image:

**Reference**: `cursor-runner/Dockerfile` (line 52)

```dockerfile
RUN npm install -g mcp-server-sqlite-npx @liangshanli/mcp-server-redis @modelcontextprotocol/server-gmail && \
    echo "MCP server packages installed globally"
```

This ensures MCP server binaries are available on PATH in the container. The Gmail MCP server (`@modelcontextprotocol/server-gmail`) is already included in the Dockerfile installation.

---

## 2. Environment Variable Flow

### 2.1 Environment Variable Sources

Environment variables flow from multiple sources:

1. **Local Development**: `.env` file (not committed, referenced in `.env.example`)
2. **Docker Compose**: `docker-compose.yml` environment section
3. **Dockerfile**: `ENV` directives (for defaults)
4. **Runtime**: Environment variables passed to container

### 2.2 Environment Variable Flow to Cursor Process

The flow of environment variables from configuration to cursor CLI process:

```
.env / docker-compose.yml
  ↓
process.env (Node.js process)
  ↓
CursorCLI.executeCommand()
  ↓
spawn() / PTY spawn() with env: process.env
  ↓
cursor CLI process (receives all env vars)
```

**Key Implementation Details**:

1. **CursorCLI Class** (`cursor-runner/src/cursor-cli.ts`):
   - Line 325: PTY spawn uses `env: process.env`
   - Line 350: Regular spawn uses `env: process.env`
   - **All environment variables from the Node.js process are passed to cursor CLI**

2. **No Filtering**: The `CursorCLI` class does not filter environment variables. All `process.env` variables are passed to spawned cursor processes.

3. **Docker Compose**: Environment variables are defined in `docker-compose.yml` and passed to the container:
   - **Reference**: `cursor-runner/docker-compose.yml` (lines 11-58)
   - Variables are set via `${VAR_NAME:-default}` syntax
   - All variables in the `environment:` section are available to the Node.js process

**References**:
- `cursor-runner/src/cursor-cli.ts` (lines 320-326, 345-351)
- `cursor-runner/docker-compose.yml` (lines 11-58)

### 2.3 System Settings

The `system-settings.ts` module provides access to system settings:

- **Database-backed settings**: Reads from shared SQLite database (`/app/shared_db/shared.sqlite3`)
- **Environment variable fallback**: Falls back to `process.env` for certain settings (e.g., `DEBUG`)
- **Reference**: `cursor-runner/src/system-settings.ts` (entire file)

**Note**: System settings are primarily for feature flags and configuration, not for passing secrets to MCP servers. MCP servers receive environment variables directly from `process.env` via the spawn process.

---

## 3. Workspace Trust Service

### 3.1 Purpose

The `WorkspaceTrustService` configures workspace trust settings and cursor CLI permissions for target application workspaces.

**Reference**: `cursor-runner/src/workspace-trust-service.ts` (entire file)

### 3.2 Files Created

The service creates/updates the following files in workspace directories:

1. **`.vscode/settings.json`**: VS Code workspace trust settings
2. **`.cursor/settings.json`**: Cursor-specific workspace trust settings
3. **`.cursor/cli.json`**: Cursor CLI permissions configuration

### 3.3 Relationship to MCP Configuration

**Important**: The `.cursor/cli.json` file created by `WorkspaceTrustService` is **separate** from MCP configuration:

- **`.cursor/cli.json`**: Defines cursor CLI permissions (what commands/files cursor CLI can access)
- **`mcp.json`**: Defines MCP servers available to cursor CLI

**No Conflict**: These files serve different purposes and do not conflict:
- `cli.json` controls **permissions** (what cursor CLI can do)
- `mcp.json` controls **MCP servers** (what external tools are available)

**Reference**: 
- `cursor-runner/src/workspace-trust-service.ts` (lines 140-213 for `.cursor/cli.json` creation)
- `cursor-runner/mcp.json` (for MCP server definitions)

### 3.4 Workspace Trust Configuration

The service ensures:
- Workspace trust is enabled
- Startup prompts are disabled
- Untrusted files can be opened
- Cursor CLI has permissions for shell commands and file operations

**Reference**: `cursor-runner/src/workspace-trust-service.ts` (lines 88-112 for trust settings, lines 159-202 for CLI permissions)

---

## 4. Docker Setup

### 4.1 Dockerfile

**Location**: `cursor-runner/Dockerfile`

**Key Points**:
- Base image: `node:18-slim`
- MCP servers installed globally: `mcp-server-sqlite-npx`, `@liangshanli/mcp-server-redis`
- Cursor CLI installed via official installer
- Entrypoint script runs MCP config merge on startup
- Working directory: `/app`

**Reference**: `cursor-runner/Dockerfile` (entire file)

### 4.2 Docker Compose

**Location**: `cursor-runner/docker-compose.yml`

**Key Points**:
- Service name: `cursor-runner`
- Port: `3001`
- Environment variables: Defined in `environment:` section (lines 11-58)
- Volumes:
  - Target app mounted at `/app/target/jarek-va`
  - Cursor agents mounted at `/app/target/cursor-agents`
  - Shared repositories volume at `/cursor`
  - Shared SQLite database at `/app/shared_db`
- Networks: `virtual-assistant-network`

**Reference**: `cursor-runner/docker-compose.yml` (entire file)

### 4.3 Environment Variable Passing in Docker

Environment variables are passed to the container via:

1. **docker-compose.yml**: `environment:` section defines variables
2. **.env file**: Variables can be referenced as `${VAR_NAME:-default}`
3. **Container runtime**: All variables in `environment:` section are available to the Node.js process as `process.env`

**Reference**: `cursor-runner/docker-compose.yml` (lines 11-58)

---

## 5. Cursor CLI Invocation

### 5.1 CursorCLI Class

**Location**: `cursor-runner/src/cursor-cli.ts`

**Key Methods**:
- `executeCommand(args, options)`: Main method for executing cursor CLI commands
- Uses semaphore for concurrency control (default: 5 concurrent executions)
- Supports PTY (pseudo-TTY) for interactive-like sessions
- Falls back to regular `spawn` if PTY unavailable

### 5.2 Command-Line Flags Used

The `CursorCLI` class uses these flags consistently:

- `--model auto`: Model selection
- `--print`: Print output
- `--force`: Force execution

**Note**: The `--debug` flag is **not** used by `CursorCLI`.

**Reference**: `cursor-runner/src/cursor-cli.ts` (lines 736, 772, 808 for flag usage)

### 5.3 Environment Variable Passing

As documented in Section 2.2, `CursorCLI` passes all `process.env` variables to spawned cursor processes:

- **PTY spawn**: `env: process.env` (line 325)
- **Regular spawn**: `env: process.env` (line 350)

**No filtering or transformation** is applied to environment variables.

---

## 6. System Instructions

### 6.1 System Instructions in Cursor Execution

The `CursorExecutionService` appends system-level instructions to prompts:

**Location**: `cursor-runner/src/cursor-execution-service.ts`

**Key Constant**: `SYSTEM_SETTINGS_MCP_INSTRUCTIONS`

This constant contains instructions that are appended to all non-review agent prompts, including:
- Git cleanup instructions
- MCP connection references (SQLite, Redis)
- Task management instructions
- Code push reporting requirements

**Reference**: `cursor-runner/src/cursor-execution-service.ts` (search for `SYSTEM_SETTINGS_MCP_INSTRUCTIONS`)

**Note**: When adding Gmail MCP, we should ensure system instructions reference Gmail MCP tools appropriately.

---

## 7. Current Email Integration Status

### 7.1 Partial Gmail Integration

Gmail MCP integration is **partially configured** in the cursor-runner system:

**Already Completed**:
- ✅ Gmail MCP server entry exists in `cursor-runner/mcp.json` (lines 19-29)
- ✅ Gmail MCP server installed in Dockerfile (`@modelcontextprotocol/server-gmail`)
- ✅ Gmail environment variables defined in `docker-compose.yml` (lines 53-58)
- ✅ Gmail environment variable getters in `system-settings.ts` (lines 82-119)
- ✅ Gmail configuration validation function in `system-settings.ts` (lines 121-143)
- ✅ Gmail configuration validation in startup (`src/index.ts`, lines 91-92, 204-234)
- ✅ Gmail MCP tests exist (`tests/mcp-config.test.ts`, `tests/system-settings-gmail-validation.test.ts`)
- ✅ Gmail verification script exists (`scripts/check-gmail-mcp.sh`)

**Status**: The Gmail MCP server is configured and installed, but requires:
- Environment variables to be set (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)
- Feature flag implementation (TASK-EML-011) for conditional enablement
- Integration tests with mocked MCP server (TASK-EML-008)
- Security review (TASK-EML-010)
- Rollout planning (TASK-EML-011)

### 7.2 Remaining Integration Tasks

Based on this inventory, the remaining Gmail MCP integration tasks are:

1. ✅ **Gmail MCP server entry** - Already in `mcp.json`
2. ✅ **Gmail MCP server installation** - Already in Dockerfile
3. ✅ **Gmail environment variables** - Already in `docker-compose.yml`
4. ✅ **Env vars flow** - Already handled by `CursorCLI`
5. ⏳ **Feature flag** - Needs implementation (TASK-EML-011)
6. ⏳ **Integration tests** - Needs implementation (TASK-EML-008)
7. ⏳ **Security review** - Needs documentation (TASK-EML-010)
8. ⏳ **Rollout planning** - Needs documentation (TASK-EML-011)

---

## 8. Assumptions and Uncertainties

### 8.1 Assumptions

1. **MCP Config Location**: Assumes cursor-cli reads MCP config from `/root/.cursor/mcp.json` in Docker container (standard location)
2. **Env Var Flow**: Assumes all `process.env` variables are available to cursor CLI (verified in code)
3. **No Conflicts**: Assumes `.cursor/cli.json` (permissions) and `mcp.json` (MCP servers) are separate concerns

### 8.2 Uncertainties to Resolve

1. ✅ **Gmail MCP Package**: Resolved - `@modelcontextprotocol/server-gmail` (installed in Dockerfile)
2. ⏳ **Gmail OAuth Scopes**: Need to document required OAuth scopes (TASK-EML-002)
3. ✅ **Gmail MCP Command**: Resolved - `mcp-server-gmail` (configured in mcp.json)
4. ⏳ **Feature Flag**: Needs implementation to conditionally enable Gmail MCP (TASK-EML-011)

---

## 9. Code References Summary

| Component | File | Key Lines | Purpose |
|-----------|------|-----------|---------|
| MCP Config | `mcp.json` | 1-31 | Defines MCP servers (including Gmail) |
| MCP Merge | `merge-mcp-config.js` | Entire file | Merges MCP configs at startup |
| Docker Entrypoint | `docker-entrypoint.sh` | 4-13 | Runs MCP config merge |
| Dockerfile | `Dockerfile` | 52, 97 | Installs MCP servers (including Gmail), sets entrypoint |
| Docker Compose | `docker-compose.yml` | 53-58 | Defines Gmail environment variables |
| Cursor CLI | `cursor-cli.ts` | 320-326, 345-351 | Spawns cursor with env vars |
| Workspace Trust | `workspace-trust-service.ts` | 140-213 | Creates `.cursor/cli.json` (separate from MCP) |
| System Settings | `system-settings.ts` | 82-143 | Gmail env var getters and validation |
| Startup Validation | `index.ts` | 91-92, 204-234 | Validates Gmail config on startup |
| MCP Config Tests | `tests/mcp-config.test.ts` | 16-70 | Tests Gmail MCP config structure |
| Gmail Validation Tests | `tests/system-settings-gmail-validation.test.ts` | Entire file | Tests Gmail config validation |

---

## 10. Next Steps

Based on this inventory, the following tasks can proceed:

1. **TASK-EML-002**: Define Gmail secrets and configuration contract (knowing env var flow)
2. **TASK-EML-003**: Add Gmail MCP dependency (knowing Dockerfile installation pattern)
3. **TASK-EML-004**: Extend MCP config (knowing `mcp.json` structure and merge process)
4. **TASK-EML-005**: Wire env vars (knowing docker-compose and env var flow)

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19  
**Next Review**: After remaining Gmail MCP integration tasks are completed

**Note**: This document reflects that Gmail MCP is already partially configured. The remaining tasks focus on feature flagging, integration testing, security review, and rollout planning.

