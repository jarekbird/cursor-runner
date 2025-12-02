# Subtask Template

**⚠️ CRITICAL: ALL IMPLEMENTATION CHANGES MUST BE MADE IN THE CURSOR-EXECUTOR APPLICATION ⚠️**

**Target Location**: All code changes, file creations, and modifications described in subtasks must be implemented in:
- **`python-cursor/cursor-executor/cursor-executor-back/`**

**DO NOT** make changes in:
- `python-cursor/cursor-runner/` (this is the Node.js reference implementation)
- Any other location

The `cursor-executor` application is the Python port target. All Python source code files, tests, configuration files, and documentation should be created or modified within the `cursor-executor-back` directory structure.

---

When creating new subtask files, use this template structure. The **Order** field is required and must be included in the file header.

## File Header Template

```markdown
# TASK-PY-XXX.YY: Subtask Title

**⚠️ CRITICAL: ALL IMPLEMENTATION CHANGES MUST BE MADE IN THE CURSOR-EXECUTOR APPLICATION ⚠️**

**Target Location**: All code changes, file creations, and modifications described in this task must be implemented in:
- **`python-cursor/cursor-executor/cursor-executor-back/`**

**DO NOT** make changes in:
- `python-cursor/cursor-runner/` (this is the Node.js reference implementation)
- Any other location

The `cursor-executor` application is the Python port target. All Python source code files, tests, configuration files, and documentation should be created or modified within the `cursor-executor-back` directory structure.

**Section**: X. Section Name
**Subsection**: X.X.YY
**Task ID**: TASK-PY-XXX.YY
**Parent Task**: TASK-PY-XXX
**Order**: Y of Z (Description of position, e.g., "First subtask in TASK-PY-XXX")
```

## Order Field Requirements

- **Format**: `Y of Z (Description)`
- **Y**: The position number (1, 2, 3, etc.)
- **Z**: Total number of subtasks in the parent task
- **Description**: Brief description of position (e.g., "First subtask", "Second subtask", "Final subtask")

## Examples

- `**Order**: 1 of 4 (First subtask in TASK-PY-001)`
- `**Order**: 2 of 6 (Second subtask in TASK-PY-002)`
- `**Order**: 7 of 7 (Seventh and final subtask in TASK-PY-005)`

## Full Template Structure

See any existing subtask file (e.g., `001.01.md`, `001.02.md`) for the complete structure including:
- Description
- Current State
- Checklist
- Specific Requirements
- Error Handling
- Testing
- Documentation
- Verification
- Notes
- Related Tasks
- Definition of Done

## Important Notes

- Always include the **Order** field in the header
- Order numbers help developers understand sequence and progress
- The order number should match the subtask number (YY in TASK-PY-XXX.YY)
- Update parent task files to show numbered subtask lists

