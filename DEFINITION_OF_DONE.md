# Definition of Done

This document defines the criteria for task completion. The review agent uses these definitions to evaluate whether a task has been completed successfully.

## Task Type Categories

### 1. CODE/FILE WRITING TASKS

**Description**: Tasks that involve writing, creating, modifying, or implementing SOURCE CODE FILES that need to be committed to git.

**Definition of Done**: "A Pull Request was created OR code was pushed to origin with the task complete"

**Examples**:
- Creating new source code files
- Modifying existing source code files
- Implementing features, functions, classes, modules
- Writing tests, specs
- Refactoring code
- Fixing bugs in source code

### 2. SYSTEM/ENVIRONMENT OPERATION TASKS

**Description**: Tasks involving installing dependencies, running builds, installing packages, running migrations, executing install scripts, etc.

**Definition of Done**: "The required operation must complete successfully with no errors, and the expected artifacts must be created. If any part of the operation fails, the task is NOT complete."

**Important Notes**:
- Installing dependencies requires packages to actually be installed successfully
- Updating package.json is NOT enough
- If the output mentions environmental issues, errors, warnings, or failed operations, the task is NOT complete

**Examples**:
- Installing npm packages, pip packages, gem dependencies
- Running database migrations
- Building/compiling projects
- Setting up development environments
- Running install scripts

