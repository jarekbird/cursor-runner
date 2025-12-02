# Subtask Breakdown Plan

This document outlines how each main task (001-018) is broken down into granular subtasks.

## TASK-PY-001: Confirm Baseline `cursor-runner` State
**Subtasks:**
- 001.01: Verify Node.js repository state and capture commit SHA
- 001.02: Run Node.js tests and verify they pass
- 001.03: Verify key source files match master plan assumptions
- 001.04: Create baseline documentation

## TASK-PY-002: Create Python Project Skeleton
**Subtasks:**
- 002.01: Create project directory structure
- 002.02: Set up Python packaging and dependencies (pyproject.toml)
- 002.03: Implement minimal FastAPI server with health endpoint
- 002.04: Create entry point for running the server
- 002.05: Configure development tooling (pytest, black, ruff, .gitignore)
- 002.06: Write and verify health endpoint tests

## TASK-PY-003: Implement Configuration & Settings Module
**Subtasks:**
- 003.01: Create SystemSettings class structure with pydantic-settings
- 003.02: Implement server and Cursor CLI configuration settings
- 003.03: Implement filesystem, Redis, and Git configuration settings
- 003.04: Implement integration and feature flag settings
- 003.05: Add field validators and required settings validation
- 003.06: Create singleton settings instance and .env.example
- 003.07: Write comprehensive tests for system settings

## TASK-PY-004: Implement Structured Logging
**Subtasks:**
- 004.01: Configure root logger and structured formatter
- 004.02: Implement context-aware logging helpers
- 004.03: Create FastAPI middleware for request logging
- 004.04: Replace print statements with proper logging
- 004.05: Write tests for logger functionality

## TASK-PY-005: Implement SQLite Migration Framework
**Subtasks:**
- 005.01: Create migration framework structure and runner
- 005.02: Implement schema_migrations table migration
- 005.03: Port system_settings table migration
- 005.04: Port tasks table migration
- 005.05: Port git_credentials table migration
- 005.06: Port telegram_bots table migration
- 005.07: Implement migration CLI (migrate, rollback, status, list)
- 005.08: Write comprehensive migration tests

## TASK-PY-006: Implement System Settings & Task Services (SQLite)
**Subtasks:**
- 006.01: Create database connection helper
- 006.02: Implement system settings service (CRUD operations)
- 006.03: Implement is_system_setting_enabled with env fallback
- 006.04: Implement task service (create, get, update, delete)
- 006.05: Implement task service (list with filtering and pagination)
- 006.06: Write tests for system settings service
- 006.07: Write tests for task service

## TASK-PY-007: Implement Filesystem & File Tree Services
**Subtasks:**
- 007.01: Implement filesystem service (exists, read_file, write_file)
- 007.02: Implement path security validation (is_within_root)
- 007.03: Implement file tree service (build_file_tree)
- 007.04: Implement ignore rules and FileNode structure
- 007.05: Write tests for filesystem service
- 007.06: Write tests for file tree service

## TASK-PY-008: Implement Workspace Trust Service
**Subtasks:**
- 008.01: Implement workspace trust service (allowed roots validation)
- 008.02: Integrate workspace trust into filesystem service
- 008.03: Integrate workspace trust into git service (when implemented)
- 008.04: Write tests for workspace trust service

## TASK-PY-009: Implement Git Services
**Subtasks:**
- 009.01: Implement git_service (clone, checkout, pull, push, list repos)
- 009.02: Implement git_completion_checker
- 009.03: Implement github_auth (non-interactive git config)
- 009.04: Write tests for git_service
- 009.05: Write tests for git_completion_checker and github_auth

## TASK-PY-010: Implement Cursor CLI Wrapper
**Subtasks:**
- 010.01: Implement concurrency semaphore (CURSOR_CLI_MAX_CONCURRENT)
- 010.02: Implement main timeout and idle timeout behavior
- 010.03: Implement safety timeout for semaphore release
- 010.04: Implement output-size caps
- 010.05: Implement PTY-like behavior (or document alternative)
- 010.06: Write comprehensive cursor CLI tests

## TASK-PY-011: Implement Conversation Service
**Subtasks:**
- 011.01: Implement Redis connection and conversation storage
- 011.02: Implement get_conversation_id and create_conversation
- 011.03: Implement add_message and get_conversation_context
- 011.04: Implement graceful degradation when Redis unavailable
- 011.05: Implement context-window error detection
- 011.06: Implement conversation summarization logic
- 011.07: Write tests for conversation service

## TASK-PY-012: Implement Agent Conversation Service
**Subtasks:**
- 012.01: Implement agent conversation CRUD operations
- 012.02: Implement listing with pagination and sorting
- 012.03: Implement status fields (active, completed, archived, failed)
- 012.04: Share Redis resilience patterns with conversation service
- 012.05: Write tests for agent conversation service

## TASK-PY-013: Implement Cursor Execution Service
**Subtasks:**
- 013.01: Implement execute method (prompt preparation, system instructions)
- 013.02: Implement execute method (validation, CursorCLI invocation, context recording)
- 013.03: Implement iterate method (loop structure, memory logging)
- 013.04: Implement iterate method (partial output handling, summarization triggers)
- 013.05: Implement callback webhook logic for async flows
- 013.06: Write comprehensive execution service tests

## TASK-PY-014: Implement HTTP API Layer
**Subtasks:**
- 014.01: Implement health endpoints (/health, /health/queue)
- 014.02: Implement cursor execution endpoints (/cursor/execute, /cursor/execute/async)
- 014.03: Implement cursor iterate endpoints (/cursor/iterate, /cursor/iterate/async)
- 014.04: Implement conversation endpoints (/cursor/conversation/new, /conversations/api/*)
- 014.05: Implement agent conversation endpoints (/agent-conversations/api/*)
- 014.06: Implement repository file browser endpoint (/repositories/api/:repository/files)
- 014.07: Implement error handling and response mapping
- 014.08: Write comprehensive API tests

## TASK-PY-015: Implement Feature Flags and MCP/Gmail Integration
**Subtasks:**
- 015.01: Implement feature_flags utility module
- 015.02: Implement Gmail MCP configuration helpers
- 015.03: Implement MCP configuration validation
- 015.04: Port MCP/Gmail tests from Node.js
- 015.05: Write tests for feature flags

## TASK-PY-016: End-to-End Lite Flows & Edge-Case Parity
**Subtasks:**
- 016.01: Write E2E tests for async iterate flows with callbacks
- 016.02: Write E2E tests for conversation and agent-conversation flows
- 016.03: Write E2E tests for error paths (unknown repos, bad requests)
- 016.04: Compare behaviors and logs with Node.js for canonical scenarios

## TASK-PY-017: Docker, Compose, and CI Integration
**Subtasks:**
- 017.01: Create Python Dockerfile
- 017.02: Update/create docker-compose files
- 017.03: Add CI workflows (lint, format, type check, tests)
- 017.04: Test Docker build and container execution

## TASK-PY-018: Integration with jarek-va and Rollout
**Subtasks:**
- 018.01: Identify all jarek-va integration points
- 018.02: Make cursor-runner base URL configurable in jarek-va
- 018.03: Add environment switch for Python vs Node backend
- 018.04: Run real-world task comparisons (feature task, review-agent flow)
- 018.05: Document rollout path for production

