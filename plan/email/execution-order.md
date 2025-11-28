# Gmail MCP + cursor-runner – Execution Order

This file breaks the Email Integration Master Plan into an ordered sequence of granular tasks that an AI agent can execute iteratively with automated tests. Each task includes user stories, implementation steps, testing expectations, and a strong definition of done.

## Repository Strategy

**All implementation changes go to the main `cursor-runner` repository** (https://github.com/jarekbird/cursor-runner.git):

- **`cursor-runner` (main repo)**: All code, config, tests, Docker, env files, and production docs
- **`assistant-integrations/cursor-runner/plan/email/`**: Planning docs, design specs, prompt templates only (this folder is for planning)

**Rationale**: `cursor-runner` already contains:
- MCP configuration (`mcp.json`)
- Docker setup (`Dockerfile`, `docker-compose.yml`)
- Environment management (`.env.example`, `system-settings.ts`)
- Test infrastructure (`tests/`)
- All service code (`src/`)

The `VirtualAssistant/` stack only needs to pass through `GMAIL_*` env vars to the cursor-runner container, which is a minimal change handled in that repo's docker-compose separately.

Each task explicitly states it modifies the `cursor-runner` repository unless noted otherwise.

---

## TASK-EML-001: Inventory Current Email/MCP Capabilities and Constraints

**Section**: 1–2 (Goal & Scope, Moving Pieces)  
**Task ID**: TASK-EML-001  
**Repository**: `assistant-integrations/cursor-runner` (planning docs only - this task is documentation)

### User Stories
- As a **developer**, I want a clear, written inventory of how `cursor-runner`, cursor CLI, and existing MCP servers are configured today so I can add Gmail without breaking anything.
- As an **operator**, I want to understand which components (Virtual Assistant stack, Docker, cursor config) are touched by the Gmail integration.

### Description
Document the current state of the system as it relates to MCP and email-like integrations, including how `cursor-runner` discovers MCP servers and how env/config is wired in the Virtual Assistant stack.

### Checklist
- [ ] Review `cursor-runner` MCP config (e.g. `cursor-runner/mcp.json` and any `.cursor/cli.json` templates).
- [ ] Review `cursor-runner` Docker setup (`cursor-runner/Dockerfile`, `cursor-runner/docker-compose.yml`) to see how services are configured.
- [ ] Confirm how `CursorCLI` (`cursor-runner/src/cursor-cli.ts`) passes env and how `WorkspaceTrustService` writes `.cursor/cli.json`.
- [ ] Capture all findings in a short markdown note under `assistant-integrations/cursor-runner/plan/email/` (e.g. `current-state.md`).

### Testing
- [ ] No automated tests required; this is a documentation task.

### Definition of Done
- [ ] `current-state.md` exists and accurately describes:
  - [ ] How MCP servers are configured and discovered.
  - [ ] How env vars reach the `cursor` process.
  - [ ] Any existing MCP servers used with `cursor-runner`.
- [ ] The document is committed with a message like `docs(email): capture current mcp/email integration state` and pushed to origin.

---

## TASK-EML-002: Define Gmail Secrets and Configuration Contract

**Section**: 3 (Configuration & Secrets)  
**Task ID**: TASK-EML-002  
**Repository**: `assistant-integrations/cursor-runner` (planning docs), then `cursor-runner` (`.env.example`, `system-settings.ts`)

### User Stories
- As an **operator**, I want a single, clear contract for Gmail-related env vars so I can configure them safely across environments.
- As a **security engineer**, I want to ensure Gmail secrets are not hard-coded and follow least-privilege principles.

### Description
Design and document the正式 environment variables and configuration needed for Gmail MCP (client ID, secret, tokens, scopes), and where they must be set (local `.env`, Docker compose, production secrets store).

### Checklist
- [ ] Choose the canonical credential mechanism (OAuth refresh token vs service account) for Gmail MCP in this stack.
- [ ] Define the full list of `GMAIL_*` env vars (e.g. `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_ALLOWED_LABELS`, etc.).
- [ ] Decide where these vars live for:
  - [ ] Local dev (`.env` files).
  - [ ] Docker (compose files / secrets).
  - [ ] Production (secret managers, not committed).
- [ ] Document required OAuth scopes and rationale.
- [ ] Create initial design doc in `assistant-integrations/cursor-runner/plan/email/config.md`.
- [ ] Implement in `cursor-runner/.env.example` and `cursor-runner/src/system-settings.ts` (if validation needed).

### Testing
- [ ] No automated tests required; configuration design only.

### Definition of Done
- [ ] A configuration doc exists in `assistant-integrations/cursor-runner/plan/email/config.md` describing all Gmail env vars, their meaning, and where they must be set.
- [ ] `cursor-runner/.env.example` includes `GMAIL_*` env vars with placeholder values.
- [ ] The doc explicitly lists required scopes and security constraints (e.g. least privilege, token rotation).
- [ ] Planning doc is committed to `assistant-integrations/cursor-runner` with a message like `docs(email): define gmail env and scope contract`.
- [ ] Implementation is committed to `cursor-runner` with a message like `feat(email): add gmail env vars to system settings` and pushed to origin.

---

## TASK-EML-003: Add Gmail MCP Dependency to cursor-runner Tooling

**Section**: 4, 7.1 (Gmail MCP dependency)  
**Task ID**: TASK-EML-003  
**Repository**: `cursor-runner` (package.json, README, Dockerfile)

### User Stories
- As a **developer**, I want the Gmail MCP server installed and available wherever `cursor-runner` runs so that cursor can call Gmail tools.
- As a **DevOps engineer**, I want installation steps to be fully automated in both local and Docker environments.

### Description
Ensure the Gmail MCP server binary (e.g. `mcp-server-gmail`) is installed and version-pinned in the environments where `cursor-runner` runs.

### Checklist
- [ ] Choose the canonical Gmail MCP implementation (npm package, binary, or internal tool).
- [ ] For local dev:
  - [ ] Add it as a dev dependency in `cursor-runner/package.json` or document a global install command.
  - [ ] Document local setup steps in `cursor-runner/README.md` or an email-specific doc.
- [ ] For Docker:
  - [ ] Update `cursor-runner/Dockerfile` to install the Gmail MCP server.
  - [ ] Ensure the binary is on `PATH` in the `cursor` process environment.

### Testing
- [ ] Add a lightweight script or `npm` script (e.g. `npm run mcp:gmail:version`) that:
  - [ ] Runs `mcp-server-gmail --version` (or equivalent) and exits 0.
- [ ] Add a CI step or local check that calls this script and fails if the binary is missing.

### Definition of Done
- [ ] Gmail MCP server is installed by automated steps in both local and Docker builds within `cursor-runner`.
- [ ] A simple command can be run in the cursor-runner container to confirm availability.
- [ ] Changes are committed in `cursor-runner` with a message like `chore(email): add gmail mcp dependency to cursor-runner` and pushed to origin.

---

## TASK-EML-004: Extend Cursor MCP Configuration with Gmail Server

**Section**: 3–4, 7.2 (MCP configuration)  
**Task ID**: TASK-EML-004  
**Repository**: `cursor-runner` (mcp.json)

### User Stories
- As a **cursor user**, I want Gmail tools to appear automatically via MCP when `cursor-runner` invokes cursor.
- As an **operator**, I want Gmail MCP config isolated and explicit so I can enable/disable it per environment.

### Description
Update the MCP configuration file(s) (`mcp.json`, `.cursor/cli.json` templates) to include a new `gmail` server entry pointing to the Gmail MCP server.

### Checklist
- [ ] Identify the authoritative MCP config used by the `cursor` process for cursor-runner (e.g. `cursor-runner/mcp.json`).
- [ ] Add a `gmail` entry with:
  - [ ] `command`: `mcp-server-gmail` (or chosen binary).
  - [ ] `args`: any required flags (e.g. `--project`, `--config`).
  - [ ] `env`: references to `GMAIL_*` env vars (do not inline secrets).
- [ ] If `WorkspaceTrustService` (`cursor-runner/src/workspace-trust-service.ts`) writes `.cursor/cli.json`, ensure it does not conflict with or override the MCP config.
- [ ] Add comments or docs explaining how to disable Gmail MCP (e.g. feature flag env var).

### Testing
- [ ] Add or update a small script/test that loads the MCP config JSON and asserts the `gmail` entry is present and well-formed.
- [ ] Optionally add an MCP connection smoke test that:
  - [ ] Starts a dummy `mcp-server-gmail` process.
  - [ ] Invokes a minimal cursor command that lists tools and validates that Gmail tools appear.

### Definition of Done
- [ ] MCP config for cursor-runner includes a correctly structured `gmail` server entry.
- [ ] Automated check(s) validate JSON shape and presence of `gmail`.
- [ ] Changes are committed with a message like `feat(email): register gmail mcp server in cursor mcp config` and pushed to origin.

---

## TASK-EML-005: Wire Gmail Env Vars into cursor-runner and Docker Runtime

**Section**: 3, 7.3 (Wire Gmail env vars)  
**Task ID**: TASK-EML-005  
**Repository**: `cursor-runner` (.env.example, system-settings.ts, docker-compose.yml)

### User Stories
- As an **operator**, I want to configure Gmail credentials once and have them available to the Gmail MCP server whenever cursor runs.
- As a **developer**, I want to detect missing Gmail config early with clear logs.

### Description
Propagate `GMAIL_*` env vars into all environments where the Gmail MCP server runs, and add validation/logging in cursor-runner startup.

### Checklist
- [ ] Update `cursor-runner/.env.example` to include `GMAIL_*` keys with placeholder values.
- [ ] Update `cursor-runner/src/system-settings.ts` to read and validate `GMAIL_*` env vars (if needed for validation).
- [ ] Ensure `CursorCLI` (`cursor-runner/src/cursor-cli.ts`) already passes `process.env` to spawned processes (verify this).
- [ ] Update `cursor-runner/docker-compose.yml` (if it exists) to pass `GMAIL_*` env vars into the cursor-runner container.
- [ ] Add a small startup check in `cursor-runner/src/` (e.g. in `server.ts` or `index.ts`) that logs a warning if critical Gmail env vars are missing when Gmail MCP is enabled.

### Testing
- [ ] Add a unit test for the startup validation function that:
  - [ ] Passes with full config.
  - [ ] Emits a warning or error when required env vars are missing.
- [ ] Add a Docker-based smoke test (or documented manual step) that starts the stack with test Gmail envs and confirms the Gmail MCP server process sees them (e.g. via a debug tool command).

### Definition of Done
- [ ] `GMAIL_*` env vars are defined in `cursor-runner/.env.example` and wired through `cursor-runner/docker-compose.yml` (if applicable).
- [ ] Validation logic in `cursor-runner` detects and clearly logs missing Gmail env in Gmail-enabled environments.
- [ ] Changes are committed in `cursor-runner` with a message like `feat(email): wire gmail env vars into cursor-runner runtime` and pushed to origin.

---

## TASK-EML-006: Define Gmail-Focused Prompt Templates and Capabilities

**Section**: 5 (Prompt & Tooling Conventions)  
**Task ID**: TASK-EML-006  
**Repository**: `assistant-integrations/cursor-runner` (planning docs), optionally propagate to `cursor-runner/docs/` later

### User Stories
- As an **agent designer**, I want reusable Gmail prompt templates so I don’t have to rediscover best practices for every task.
- As a **VA operator**, I want agents to consistently use Gmail MCP tools rather than ad-hoc HTTP calls.

### Description
Create reusable prompt templates and capability descriptions for Gmail workflows (summarize inbox, draft replies, extract receipts) that explicitly instruct the agent to use Gmail MCP tools.

### Checklist
- [ ] Create a `prompts-gmail.md` (or similar) under `assistant-integrations/cursor-runner/plan/email/`.
- [ ] Document high-level Gmail capabilities (read/summarize, draft replies, extract structured data).
- [ ] Add at least 3–5 concrete prompt templates for:
  - [ ] Summarizing unread messages in a label/time window.
  - [ ] Drafting replies for a given thread.
  - [ ] Extracting receipts/schedules into structured JSON.
- [ ] Ensure templates explicitly say "use the Gmail MCP tools" and avoid direct API details.

### Testing
- [ ] No automated tests required; however, templates should be reviewed for clarity and compatibility with existing system instructions in `cursor-runner`.

### Definition of Done
- [ ] A prompt library file for Gmail exists with clearly written capabilities and concrete templates.
- [ ] Templates explicitly direct the agent to use Gmail MCP tools.
- [ ] Changes are committed with a message like `docs(email): add gmail prompt templates and capabilities` and pushed to origin.

---

## TASK-EML-007: Design End-to-End Gmail Flow Scenarios

**Section**: 6 (End-to-End Flow Design)  
**Task ID**: TASK-EML-007  
**Repository**: `assistant-integrations/cursor-runner` (planning docs)

### User Stories
- As a **product owner**, I want clear end-to-end Gmail scenarios (e.g., "summarize my inbox") spelled out so we can test what matters.
- As a **QA engineer**, I want concrete flows to drive integration and acceptance tests.

### Description
Detail the end-to-end flows described in the master plan, including trigger sources, execution paths, and result handling for Gmail scenarios.

### Checklist
- [ ] Define at least 3 primary Gmail flows, such as:
  - [ ] Summarize unread inbox messages for a user.
  - [ ] Draft and optionally send a reply for a given thread.
  - [ ] Extract receipts and store them in a structured format.
- [ ] For each flow, document:
  - [ ] Trigger source (jarek-va task, scheduled agent, manual trigger).
  - [ ] Exact HTTP calls into `cursor-runner` (endpoint, body shape).
  - [ ] How prompts are built (including conversation context).
  - [ ] Expected Gmail MCP tools and outputs.
  - [ ] How results are returned to jarek-va / downstream systems.
- [ ] Save these as `flows-gmail.md` in the email plan folder.

### Testing
- [ ] No code tests yet; these flows will be used as the basis for later integration tests.

### Definition of Done
- [ ] A flows document exists describing each end-to-end Gmail scenario in enough detail to implement tests.
- [ ] Flows reference real endpoints and payload shapes from `cursor-runner`.
- [ ] Changes are committed with a message like `docs(email): define end-to-end gmail flow scenarios` and pushed to origin.

---

## TASK-EML-008: Implement Integration Tests for Gmail Flows (Mocked MCP)

**Section**: 7.5 (Integration tests)  
**Task ID**: TASK-EML-008  
**Repository**: `cursor-runner` (tests/)

### User Stories
- As a **developer**, I want automated tests that prove cursor-runner calls Gmail MCP correctly (at the protocol/contract level) without needing real Gmail.
- As a **QA engineer**, I want repeatable tests that validate happy paths and error conditions.

### Description
Create integration tests (likely in the Virtual Assistant or cursor-runner test suite) that mock the Gmail MCP server and verify calls made via `/cursor/iterate` and related endpoints.

### Checklist
- [ ] Add integration tests in `cursor-runner/tests/test_gmail_integration.test.ts` (or similar).
- [ ] Implement a mocked Gmail MCP server that:
  - [ ] Listens on a local port / process.
  - [ ] Provides stub tool definitions and responses.
- [ ] Add tests that:
  - [ ] Call `/cursor/iterate` with a Gmail prompt and verify that the cursor CLI is invoked with MCP available.
  - [ ] Validate that the response body includes fields derived from the mocked Gmail responses.
- [ ] Cover failure modes (e.g. Gmail MCP unavailable, auth error from MCP) and ensure error surfaces sanely.

### Testing
- [ ] Run the relevant Node/VA test suite (e.g. `npm test` or `npm run ci`) and ensure new Gmail tests pass.
- [ ] Follow safe testing practices (no hanging servers; ensure all spawned processes and listeners are torn down).

### Definition of Done
- [ ] Integration tests exist for at least the main Gmail flows using a mocked MCP server.
- [ ] Tests pass reliably in CI and local environments.
- [ ] Changes are committed with a message like `test(email): add integration tests for gmail mcp flows` and pushed to origin.

---

## TASK-EML-009: Optional Live Gmail Smoke Test (Non-CI)

**Section**: 7.5 (Optional smoke tests)  
**Task ID**: TASK-EML-009  
**Repository**: `cursor-runner` (scripts/ or tests/)

### User Stories
- As a **maintainer**, I want a manual or gated test that exercises a real Gmail account to catch configuration or scope issues before production.

### Description
Create a small, opt-in smoke test that hits a test Gmail account via Gmail MCP and runs one or two safe operations (e.g. list labels, read a test label).

### Checklist
- [ ] Implement a script or test (`gmail_smoke_test.ts`/`.js`/`.py`) that:
  - [ ] Uses the configured Gmail MCP server.
  - [ ] Performs a safe read-only action (e.g. list labels or read a known label).
- [ ] Ensure this test is **not** run in CI by default (guard via env flag like `ENABLE_GMAIL_SMOKE_TEST=1`).
- [ ] Document how and when to run this test.

### Testing
- [ ] Run the smoke test manually against a dedicated test Gmail account.

### Definition of Done
- [ ] A documented, opt-in smoke test exists and can successfully reach Gmail through MCP when properly configured.
- [ ] The test is clearly marked as non-CI and safe to run.
- [ ] Changes are committed with a message like `chore(email): add optional live gmail smoke test` and pushed to origin.

---

## TASK-EML-010: Security and Privacy Review for Gmail Integration

**Section**: 7.6 (Security & privacy review)  
**Task ID**: TASK-EML-010  
**Repository**: `assistant-integrations/cursor-runner` (planning docs), then `cursor-runner` (code changes if needed)

### User Stories
- As a **security engineer**, I want a documented review of how Gmail data is accessed, stored, and logged.
- As a **customer**, I want assurance that my email contents are handled responsibly.

### Description
Perform and document a security/privacy review focused on Gmail integration: scopes, logging, data retention, and ability to revoke access.

### Checklist
- [ ] Review OAuth scopes actually used vs requested; minimize where possible.
- [ ] Audit logging in cursor-runner and related services to ensure email bodies are truncated or redacted in logs.
- [ ] Document data retention expectations for Gmail-derived data (e.g. conversation history in Redis, persisted summaries).
- [ ] Document how to revoke Gmail access (e.g. revoke tokens, disable env vars, remove MCP config).
- [ ] Capture this in `security-privacy-gmail.md` in the email plan folder.

### Testing
- [ ] No automated tests; this is a process/documentation task.

### Definition of Done
- [ ] Security/privacy document exists, covering scopes, logging, retention, and revocation.
- [ ] Any changes required to reduce scope or scrub logs are tracked as follow-up tasks.
- [ ] Changes are committed with a message like `docs(email): add security and privacy review for gmail integration` and pushed to origin.

---

## TASK-EML-011: Rollout Planning and Feature Flagging

**Section**: 8 (Rollout Plan)  
**Task ID**: TASK-EML-011  
**Repository**: `cursor-runner` (feature flag logic in system-settings.ts, mcp.json conditional, docker-compose env configs)

### User Stories
- As a **release manager**, I want a controlled rollout of Gmail MCP integration across dev, staging, and production.
- As an **operator**, I want to be able to quickly disable Gmail integration if problems occur.

### Description
Plan and implement the rollout approach for Gmail MCP, including environment-specific enablement and a simple feature flag.

### Checklist
- [ ] Introduce a feature flag env var (e.g. `ENABLE_GMAIL_MCP=true/false`) in `cursor-runner/src/system-settings.ts`.
- [ ] Update MCP config loading logic (wherever `mcp.json` is read) to conditionally include the `gmail` entry based on the flag.
- [ ] Configure `ENABLE_GMAIL_MCP` per environment in `cursor-runner/docker-compose.yml` or `.env.example`:
  - [ ] Dev: flag enabled by default for developers with test accounts.
  - [ ] Staging: flag enabled only with test Gmail credentials.
  - [ ] Production: flag default off until ready, then enabled in a controlled manner.
- [ ] Document rollout steps and rollback procedure in `assistant-integrations/cursor-runner/plan/email/rollout-gmail.md`.

### Testing
- [ ] Add a small automated test or script that verifies behavior when `ENABLE_GMAIL_MCP` is on vs off (e.g. config includes/excludes Gmail MCP entry).

### Definition of Done
- [ ] Feature flag is wired in `cursor-runner/src/system-settings.ts` and honored by the MCP configuration logic.
- [ ] Environment-specific flag values are configured in `cursor-runner/docker-compose.yml` or `.env.example`.
- [ ] Rollout and rollback procedures are documented in `assistant-integrations/cursor-runner/plan/email/rollout-gmail.md`.
- [ ] Changes are committed in `cursor-runner` with a message like `feat(email): add gmail mcp feature flag and rollout plan` and pushed to origin.

