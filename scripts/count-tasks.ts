import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { join } from 'path';

const DB_PATH = '/app/shared_db/shared.sqlite3';

interface TaskCounts {
  ready: number;
  completed: number;
  timestamp: string;
}

function countTasks(): TaskCounts {
  const db = new Database(DB_PATH, { readonly: true });
  
  try {
    // Count ready tasks (status = 0)
    const readyResult = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = 0').get() as { count: number };
    const readyCount = readyResult.count;
    
    // Count completed tasks (status = 1)
    const completedResult = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = 1').get() as { count: number };
    const completedCount = completedResult.count;
    
    return {
      ready: readyCount,
      completed: completedCount,
      timestamp: new Date().toISOString()
    };
  } finally {
    db.close();
  }
}

function saveResults(counts: TaskCounts): void {
  const outputPath = join(process.cwd(), 'task-counts.json');
  const output = {
    ...counts,
    summary: `Ready tasks: ${counts.ready}, Completed tasks: ${counts.completed}`
  };
  
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${outputPath}`);
}

function main(): void {
  console.log('Counting tasks...');
  const counts = countTasks();
  
  console.log('\nTask counts:');
  console.log(`- Ready tasks (status = 0): ${counts.ready}`);
  console.log(`- Completed tasks (status = 1): ${counts.completed}`);
  console.log(`- Timestamp: ${counts.timestamp}`);
  
  saveResults(counts);
  
  // Exit with success
  process.exit(0);
}

main();
