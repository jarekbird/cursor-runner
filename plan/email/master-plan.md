# Email Integration Master Plan – Gmail MCP + cursor-runner

## 1. Goal & Scope

- **Goal**: Allow the `cursor-runner` CLI (via cursor-cli) to read from and act on Gmail using the **Gmail MCP server**, so agents/tasks can:
  - Read, summarize, and draft responses to emails.
  - Auto-categorize and tag important messages.
  - Extract structured data from emails (receipts, schedules, client details).
- **Out of scope for now**: UI changes, non-Gmail providers, and complex policy/routing; those can be layered on after a working end‑to‑end path.

## 2. Understand the Moving Pieces

- **cursor-runner**
  - Orchestrates `cursor` CLI via `CursorCLI` (`src/cursor-cli.ts`) and `CursorExecutionService` (`src/cursor-execution-service.ts`).
  - Already configured to use MCP tools via cursor’s own config (`.cursor/cli.json`, MCP registry, etc.).
- **Gmail MCP server**
  - Runs as a separate process (e.g. `mcp-server-gmail ...`) and exposes tools like `listMessages`, `getMessage`, `sendReply`, etc.
  - Is discovered by cursor through **MCP configuration** (`mcpServers` in Cursor settings / `mcp.json`).
- **cursor-cli**
  - Uses MCP configuration to discover tools; `cursor-runner` doesn’t call Gmail directly, it just sends prompts that invoke the Gmail tools.

## 3. Configuration & Secrets

1. **Decide where Gmail secrets live**
   - Use environment variables in the Virtual Assistant / Docker stack, e.g.:
     - `GMAIL_CLIENT_ID`
     - `GMAIL_CLIENT_SECRET`
     - `GMAIL_REFRESH_TOKEN` (or service account JSON path)
   - Ensure these are **not** committed and are wired via `.env` / Docker compose.
2. **Extend MCP configuration to include Gmail**
   - In the Cursor MCP config used by the `cursor` process, add a new server entry, e.g.:
     - Name: `gmail`
     - Command: the Gmail MCP server binary or `npx mcp-server-gmail`.
     - Args/env: pass Gmail credentials and any required scopes/labels.
   - Verify this config file is mounted into the container/host where `cursor` runs.
3. **Document required env vars**
   - Update the relevant README (Virtual Assistant / infra) with:
     - Required Gmail OAuth scopes.
     - How to obtain and rotate tokens.
     - Security constraints (least privilege, no broad `gmail.modify` if not needed).

## 4. Wiring Gmail MCP into the cursor-runner Environment

1. **Ensure the Gmail MCP server binary is available**
   - Add it to the appropriate `package.json` or system-level install step (e.g. `npm i -D mcp-server-gmail` or Docker image layer).
   - For Docker: bake the binary / `npx` dependency into the `cursor-runner` or shared base image.
2. **Update Cursor MCP config used by cursor-cli**
   - Locate where `.cursor/cli.json` or `mcp.json` is created/configured for the workspace (see `WorkspaceTrustService` and any existing MCP config like `VirtualAssistant/cursor-runner/mcp.json`).
   - Add a `gmail` entry mirroring how `cursor-runner-shared-sqlite` and `cursor-runner-shared-redis` are configured, but pointing at the Gmail MCP server command.
3. **Propagate env into the cursor process**
   - Confirm that `CursorCLI` (`src/cursor-cli.ts`) already passes `process.env` to the spawned process (it does).
   - Ensure Gmail-related env vars are set in:
     - Local `.env` for development.
     - Docker Compose for Virtual Assistant / cursor-runner.

## 5. Prompt & Tooling Conventions for Gmail

1. **Define high-level Gmail “capabilities” to expose to agents**
   - Read/summarize inbox for a time range or label.
   - Draft replies for specific threads.
   - Extract structured data: receipts, schedules, client details.
2. **Write canonical prompt templates** (to live in task files / agents, not in code):
   - "Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox, then summarize them in 3 bullets each."
   - "Given this customer thread ID, use Gmail tools to read the last 10 messages and draft a polite reply that…"
   - "Scan the last 30 days of emails labeled 'Receipts' and extract merchant, total, date into JSON." 
3. **Ensure prompts are compatible with existing system instructions**
   - `CursorExecutionService` appends long MCP/system instructions to every prompt; templates must be concise but explicit about **using Gmail MCP tools**.

## 6. End‑to‑End Flow Design

1. **Trigger sources**
   - jarek‑va task → calls `cursor-runner` `/cursor/iterate/async` with a Gmail‑focused prompt.
   - Scheduled agent (via `cursor-agents`) → uses `CURSOR_RUNNER_URL` to trigger `cursor-runner` with a Gmail prompt.
2. **Execution path**
   - HTTP request hits `cursor-runner` → `CursorExecutionService.iterate`.
   - `CursorExecutionService` builds a prompt (with conversation context + system MCP instructions) that instructs the agent to use the Gmail MCP tools.
   - `CursorCLI.executeCommand` runs `cursor --model auto --print --force <fullPrompt>`.
   - `cursor` discovers the `gmail` MCP server from MCP config and calls its tools to talk to Gmail.
3. **Results handling**
   - Raw tool output stays in stdout; `cursor-runner` stores it in Redis conversation history and returns it to jarek‑va / caller.
   - For structured data (receipts, schedules), standardize JSON response shapes in the prompts so downstream code can parse them.

## 7. Implementation Steps (Concrete Checklist)

1. **Add Gmail MCP dependency**
   - Decide the canonical gmail MCP implementation (internal or external).
   - Add install steps:
     - Local dev: document `npm install -g mcp-server-gmail` or project-local dev dependency.
     - Docker: extend image to install the Gmail MCP server binary.
2. **Extend MCP configuration**
   - Update the Cursor MCP config (e.g. `VirtualAssistant/cursor-runner/mcp.json` or `.cursor/cli.json` template) with:
     - `"gmail": { "command": "mcp-server-gmail", "args": [...], "env": { ... } }`.
   - Ensure this config is mounted/visible wherever `cursor` runs for `cursor-runner`.
3. **Wire Gmail env vars into runtime**
   - Add `GMAIL_*` env vars to:
     - `.env.example` for the stack that runs Gmail.
     - Docker Compose files.
   - Optionally add a small validation hook (startup log message) that warns if Gmail env vars are missing.
4. **Create example tasks/prompts**
   - Add one or more task markdown files describing Gmail workflows (summarize inbox, draft reply, extract receipts).
   - Make sure they explicitly instruct "use the Gmail MCP tools" so the agent doesn’t hallucinate direct HTTP calls.
5. **Integration tests**
   - Add tests in the appropriate test project (e.g. Virtual Assistant) that:
     - Mock the Gmail MCP server process (or run it against a test Gmail account/sandbox).
     - Call `cursor-runner` `/cursor/iterate` with a Gmail prompt and assert that:
       - The `cursor` command starts successfully.
       - The response contains expected Gmail-derived fields.
   - Optionally create a very small smoke test that actually hits a test Gmail account in non‑CI environments.
6. **Security & privacy review**
   - Verify scopes and data retention policies for Gmail data.
   - Ensure logs do **not** contain full email bodies by default (truncate or scrub where necessary).
   - Document how to revoke credentials and disable Gmail integration.

## 8. Rollout Plan

1. **Phase 1 – Dev only**
   - Enable Gmail MCP config only in development.
   - Run manual end‑to‑end flows via tasks that exercise the Gmail tools.
2. **Phase 2 – Internal / staging**
   - Enable Gmail MCP in staging/QA environments with test Gmail accounts.
   - Validate reliability, latency, and error handling.
3. **Phase 3 – Production‑ready**
   - Finalize documentation for setup, env vars, and how to create Gmail‑based tasks/agents.
   - Enable in production behind a feature flag or configuration toggle.

