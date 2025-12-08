/**
 * Unit tests for TaskService
 * Tests CRUD operations, ordering, and status labels
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TaskService, TaskStatus } from '../src/task-service.js';
import { createTempSqliteDb, type TempSqliteDb } from './test-utils.js';

describe('TaskService - Basic Operations', () => {
  let tempDb: TempSqliteDb;
  let originalSharedDbPath: string | undefined;
  let taskService: TaskService;

  beforeAll(async () => {
    // Save original SHARED_DB_PATH
    originalSharedDbPath = process.env.SHARED_DB_PATH;

    // Create temp SQLite DB and run migrations
    tempDb = await createTempSqliteDb();

    // Set SHARED_DB_PATH to temp DB path
    process.env.SHARED_DB_PATH = tempDb.dbPath;

    // Create TaskService instance (it will use the temp DB)
    taskService = new TaskService();
  });

  afterAll(async () => {
    // Restore original SHARED_DB_PATH
    if (originalSharedDbPath) {
      process.env.SHARED_DB_PATH = originalSharedDbPath;
    } else {
      delete process.env.SHARED_DB_PATH;
    }

    // Clean up temp DB
    if (tempDb && tempDb.cleanup) {
      await tempDb.cleanup();
    }
  });

  beforeEach(() => {
    // Clear all tasks before each test
    const db = (taskService as any).getDatabase();
    db.prepare('DELETE FROM tasks').run();
  });

  it('should return all tasks ordered by order then id', () => {
    // Create tasks with different orders
    taskService.createTask('Task 1', 2, TaskStatus.READY);
    taskService.createTask('Task 2', 1, TaskStatus.READY);
    taskService.createTask('Task 3', 2, TaskStatus.READY); // Same order as Task 1
    taskService.createTask('Task 4', 0, TaskStatus.READY);

    const tasks = taskService.listTasks();

    expect(tasks.length).toBe(4);
    // Should be ordered by order (ascending), then by id (ascending)
    expect(tasks[0].prompt).toBe('Task 4'); // order = 0
    expect(tasks[1].prompt).toBe('Task 2'); // order = 1
    // Tasks with order = 2 should be ordered by id
    expect(tasks[2].order).toBe(2);
    expect(tasks[3].order).toBe(2);
    expect(tasks[2].id).toBeLessThan(tasks[3].id);
  });

  it('should filter tasks by status', () => {
    // Create tasks with different statuses
    taskService.createTask('Ready Task 1', 0, TaskStatus.READY);
    taskService.createTask('Complete Task 1', 0, TaskStatus.COMPLETE);
    taskService.createTask('Ready Task 2', 0, TaskStatus.READY);
    taskService.createTask('Complete Task 2', 0, TaskStatus.COMPLETE);

    const readyTasks = taskService.listTasks(TaskStatus.READY);
    const completeTasks = taskService.listTasks(TaskStatus.COMPLETE);

    expect(readyTasks.length).toBe(2);
    expect(readyTasks.every((t) => t.status === TaskStatus.READY)).toBe(true);
    expect(readyTasks.every((t) => t.status_label === 'ready')).toBe(true);

    expect(completeTasks.length).toBe(2);
    expect(completeTasks.every((t) => t.status === TaskStatus.COMPLETE)).toBe(true);
    expect(completeTasks.every((t) => t.status_label === 'complete')).toBe(true);
  });

  it('should create task with timestamps and correct status_label', () => {
    const now = Date.now();
    const task = taskService.createTask('Test task', 5, TaskStatus.READY);

    expect(task.prompt).toBe('Test task');
    expect(task.order).toBe(5);
    expect(task.status).toBe(TaskStatus.READY);
    expect(task.status_label).toBe('ready');
    expect(task.id).toBeDefined();
    expect(task.createdat).toBeDefined();
    expect(task.updatedat).toBeDefined();

    // Verify timestamps are recent (within last 5 seconds)
    const createdAt = new Date(task.createdat).getTime();
    const updatedAt = new Date(task.updatedat).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(now - 5000);
    expect(updatedAt).toBeGreaterThanOrEqual(now - 5000);
    expect(createdAt).toBeLessThanOrEqual(now + 5000);
    expect(updatedAt).toBeLessThanOrEqual(now + 5000);
  });

  it('should return task by id or null', () => {
    const task1 = taskService.createTask('Task 1', 0, TaskStatus.READY);
    const task2 = taskService.createTask('Task 2', 0, TaskStatus.READY);

    const foundTask1 = taskService.getTaskById(task1.id);
    const foundTask2 = taskService.getTaskById(task2.id);
    const notFound = taskService.getTaskById(99999);

    expect(foundTask1).toBeDefined();
    expect(foundTask1?.id).toBe(task1.id);
    expect(foundTask1?.prompt).toBe('Task 1');

    expect(foundTask2).toBeDefined();
    expect(foundTask2?.id).toBe(task2.id);
    expect(foundTask2?.prompt).toBe('Task 2');

    expect(notFound).toBeNull();
  });
});

describe('TaskService - Update Operations', () => {
  let tempDb: TempSqliteDb;
  let originalSharedDbPath: string | undefined;
  let taskService: TaskService;

  beforeAll(async () => {
    // Save original SHARED_DB_PATH
    originalSharedDbPath = process.env.SHARED_DB_PATH;

    // Create temp SQLite DB and run migrations
    tempDb = await createTempSqliteDb();

    // Set SHARED_DB_PATH to temp DB path
    process.env.SHARED_DB_PATH = tempDb.dbPath;

    // Create TaskService instance (it will use the temp DB)
    taskService = new TaskService();
  });

  afterAll(async () => {
    // Close database connection
    taskService.close();

    // Restore original SHARED_DB_PATH
    if (originalSharedDbPath) {
      process.env.SHARED_DB_PATH = originalSharedDbPath;
    } else {
      delete process.env.SHARED_DB_PATH;
    }

    // Clean up temp DB
    if (tempDb && tempDb.cleanup) {
      await tempDb.cleanup();
    }
  });

  beforeEach(() => {
    // Clear all tasks before each test
    const db = (taskService as any).getDatabase();
    db.prepare('DELETE FROM tasks').run();
  });

  it('should return existing task when updateTask called with no changes', () => {
    const task = taskService.createTask('Original task', 0, TaskStatus.READY);
    const originalUpdatedAt = task.updatedat;

    // Wait a bit to ensure timestamp would change if updated
    const updatedTask = taskService.updateTask(task.id, {});

    expect(updatedTask).toBeDefined();
    expect(updatedTask?.id).toBe(task.id);
    expect(updatedTask?.prompt).toBe('Original task');
    expect(updatedTask?.status).toBe(TaskStatus.READY);
    // updatedat should remain the same when no changes are made
    expect(updatedTask?.updatedat).toBe(originalUpdatedAt);
  });

  it('should update only provided fields', () => {
    const task = taskService.createTask('Original task', 0, TaskStatus.READY);
    const originalCreatedAt = task.createdat;

    // Update only prompt
    const updatedTask = taskService.updateTask(task.id, { prompt: 'Updated task' });

    expect(updatedTask).toBeDefined();
    expect(updatedTask?.prompt).toBe('Updated task');
    expect(updatedTask?.status).toBe(TaskStatus.READY); // Unchanged
    expect(updatedTask?.order).toBe(0); // Unchanged
    expect(updatedTask?.createdat).toBe(originalCreatedAt); // Unchanged

    // Update only status
    const updatedTask2 = taskService.updateTask(task.id, { status: TaskStatus.COMPLETE });

    expect(updatedTask2?.status).toBe(TaskStatus.COMPLETE);
    expect(updatedTask2?.status_label).toBe('complete');
    expect(updatedTask2?.prompt).toBe('Updated task'); // Still updated from previous call
    expect(updatedTask2?.order).toBe(0); // Unchanged

    // Update only order
    const updatedTask3 = taskService.updateTask(task.id, { order: 5 });

    expect(updatedTask3?.order).toBe(5);
    expect(updatedTask3?.status).toBe(TaskStatus.COMPLETE); // Still updated from previous call
    expect(updatedTask3?.prompt).toBe('Updated task'); // Still updated from previous call
  });

  it('should update updatedat timestamp when task is updated', async () => {
    const task = taskService.createTask('Original task', 0, TaskStatus.READY);
    const originalUpdatedAt = task.updatedat;

    // Wait a bit to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updatedTask = taskService.updateTask(task.id, { prompt: 'Updated task' });

    expect(updatedTask).toBeDefined();
    expect(updatedTask?.updatedat).not.toBe(originalUpdatedAt);
    expect(new Date(updatedTask!.updatedat).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime()
    );
  });

  it('should return true only when row is deleted', () => {
    const task1 = taskService.createTask('Task 1', 0, TaskStatus.READY);
    const task2 = taskService.createTask('Task 2', 0, TaskStatus.READY);

    // Delete existing task
    const deleted1 = taskService.deleteTask(task1.id);
    expect(deleted1).toBe(true);

    // Verify task is deleted
    const found = taskService.getTaskById(task1.id);
    expect(found).toBeNull();

    // Verify other task still exists
    const found2 = taskService.getTaskById(task2.id);
    expect(found2).toBeDefined();

    // Try to delete non-existent task
    const deleted2 = taskService.deleteTask(99999);
    expect(deleted2).toBe(false);
  });

  it('should close DB and allow re-open', () => {
    // Create a task
    const task = taskService.createTask('Test task', 0, TaskStatus.READY);
    expect(task).toBeDefined();

    // Close the database
    taskService.close();

    // Verify we can still access the database (it should re-open)
    const tasks = taskService.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].id).toBe(task.id);
  });
});
