import Database from 'better-sqlite3';
import { logger } from './logger.js';

/**
 * Get the path to the shared SQLite database
 * Reads from process.env dynamically to support testing with different DB paths
 */
function getSharedDbPath(): string {
  return process.env.SHARED_DB_PATH || '/app/shared_db/shared.sqlite3';
}

/**
 * Task status enum values
 */
export enum TaskStatus {
  READY = 0,
  COMPLETE = 1,
  ARCHIVED = 2,
  BACKLOGGED = 3,
  IN_PROGRESS = 4,
}

/**
 * Task interface matching the database schema
 */
export interface Task {
  id: number;
  prompt: string;
  status: TaskStatus;
  status_label: 'ready' | 'complete' | 'archived' | 'backlogged' | 'in_progress' | 'unknown';
  createdat: string;
  updatedat: string;
  order: number;
  uuid: string | null;
}

/**
 * Convert task status number to label
 */
function getStatusLabel(
  status: TaskStatus
): 'ready' | 'complete' | 'archived' | 'backlogged' | 'in_progress' | 'unknown' {
  switch (status) {
    case TaskStatus.READY:
      return 'ready';
    case TaskStatus.COMPLETE:
      return 'complete';
    case TaskStatus.ARCHIVED:
      return 'archived';
    case TaskStatus.BACKLOGGED:
      return 'backlogged';
    case TaskStatus.IN_PROGRESS:
      return 'in_progress';
    default:
      return 'unknown';
  }
}

/**
 * Map database row to Task interface with status_label
 */
function mapTaskRow(row: {
  id: number;
  prompt: string;
  status: number;
  createdat: string;
  updatedat: string;
  order: number;
  uuid: string | null;
}): Task {
  return {
    ...row,
    status: row.status as TaskStatus,
    status_label: getStatusLabel(row.status as TaskStatus),
  };
}

/**
 * TaskService - Manages tasks in the shared SQLite database
 */
export class TaskService {
  private db: Database.Database | null = null;

  /**
   * Get database connection (lazy initialization)
   */
  private getDatabase(): Database.Database {
    if (!this.db) {
      try {
        const dbPath = getSharedDbPath();
        this.db = new Database(dbPath);
        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        logger.debug('Database connection established for tasks', { path: dbPath });
      } catch (error) {
        const dbPath = getSharedDbPath();
        logger.error('Failed to connect to database for tasks', {
          path: dbPath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return this.db;
  }

  /**
   * List all tasks, optionally filtered by status
   */
  listTasks(status?: TaskStatus): Task[] {
    try {
      const db = this.getDatabase();
      let query = 'SELECT * FROM tasks';
      const params: unknown[] = [];

      if (status !== undefined) {
        query += ' WHERE status = ?';
        params.push(status);
      }

      query += ' ORDER BY "order" ASC, id ASC';

      const rows = db.prepare(query).all(...params) as Array<{
        id: number;
        prompt: string;
        status: number;
        createdat: string;
        updatedat: string;
        order: number;
        uuid: string | null;
      }>;
      return rows.map(mapTaskRow);
    } catch (error) {
      logger.error('Failed to list tasks', {
        error: error instanceof Error ? error.message : String(error),
        status,
      });
      throw error;
    }
  }

  /**
   * Get a task by ID
   */
  getTaskById(id: number): Task | null {
    try {
      const db = this.getDatabase();
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
        | {
            id: number;
            prompt: string;
            status: number;
            createdat: string;
            updatedat: string;
            order: number;
            uuid: string | null;
          }
        | undefined;
      return row ? mapTaskRow(row) : null;
    } catch (error) {
      logger.error('Failed to get task by ID', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw error;
    }
  }

  /**
   * Create a new task
   */
  createTask(prompt: string, order: number = 0, status: TaskStatus = TaskStatus.READY): Task {
    try {
      const db = this.getDatabase();
      const now = new Date().toISOString();
      const result = db
        .prepare(
          'INSERT INTO tasks (prompt, "order", status, createdat, updatedat) VALUES (?, ?, ?, ?, ?)'
        )
        .run(prompt, order, status, now, now);

      const task = this.getTaskById(result.lastInsertRowid as number);
      if (!task) {
        throw new Error('Failed to retrieve created task');
      }

      logger.info('Task created', { id: task.id, prompt: prompt.substring(0, 50) });
      return task;
    } catch (error) {
      logger.error('Failed to create task', {
        error: error instanceof Error ? error.message : String(error),
        prompt: prompt.substring(0, 50),
      });
      throw error;
    }
  }

  /**
   * Update a task
   */
  updateTask(
    id: number,
    updates: {
      prompt?: string;
      status?: TaskStatus;
      order?: number;
    }
  ): Task | null {
    try {
      const db = this.getDatabase();
      const updatesList: string[] = [];
      const params: unknown[] = [];

      if (updates.prompt !== undefined) {
        updatesList.push('prompt = ?');
        params.push(updates.prompt);
      }

      if (updates.status !== undefined) {
        updatesList.push('status = ?');
        params.push(updates.status);
      }

      if (updates.order !== undefined) {
        updatesList.push('"order" = ?');
        params.push(updates.order);
      }

      if (updatesList.length === 0) {
        return this.getTaskById(id);
      }

      updatesList.push('updatedat = ?');
      params.push(new Date().toISOString());
      params.push(id);

      db.prepare(`UPDATE tasks SET ${updatesList.join(', ')} WHERE id = ?`).run(...params);

      return this.getTaskById(id);
    } catch (error) {
      logger.error('Failed to update task', {
        error: error instanceof Error ? error.message : String(error),
        id,
        updates,
      });
      throw error;
    }
  }

  /**
   * Delete a task
   */
  deleteTask(id: number): boolean {
    try {
      const db = this.getDatabase();
      const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error) {
      logger.error('Failed to delete task', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw error;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
