import Database from 'better-sqlite3';

const DB_PATH = '/app/shared_db/shared.sqlite3';

interface TaskStatusCount {
  status: number;
  count: number;
  label: string;
}

function getStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    0: 'ready',
    1: 'complete',
    2: 'archived',
    3: 'backlogged',
    4: 'in_progress'
  };
  return labels[status] || `unknown (${status})`;
}

function getTaskStatusDistribution(db: Database.Database): TaskStatusCount[] {
  const result = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM tasks 
    GROUP BY status 
    ORDER BY status
  `).all() as Array<{ status: number; count: number }>;
  
  return result.map(row => ({
    status: row.status,
    count: row.count,
    label: getStatusLabel(row.status)
  }));
}

function setCompletedTasksToReady(db: Database.Database): number {
  const result = db.prepare(`
    UPDATE tasks 
    SET status = 0, updatedat = CURRENT_TIMESTAMP 
    WHERE status = 1
  `).run();
  
  return result.changes;
}

function main(): void {
  console.log('Setting completed tasks to ready...\n');
  
  const db = new Database(DB_PATH);
  
  try {
    // Show current status distribution
    console.log('Current task status distribution:');
    const beforeDistribution = getTaskStatusDistribution(db);
    beforeDistribution.forEach(({ status, count, label }) => {
      console.log(`  Status ${status} (${label}): ${count} tasks`);
    });
    
    // Set completed tasks to ready
    const updatedCount = setCompletedTasksToReady(db);
    
    console.log(`\nUpdated ${updatedCount} completed tasks to ready status.`);
    
    // Show updated status distribution
    console.log('\nUpdated task status distribution:');
    const afterDistribution = getTaskStatusDistribution(db);
    afterDistribution.forEach(({ status, count, label }) => {
      console.log(`  Status ${status} (${label}): ${count} tasks`);
    });
    
    if (updatedCount > 0) {
      console.log(`\n✓ Successfully set ${updatedCount} tasks to ready.`);
    } else {
      console.log('\n✓ No tasks were updated (no completed tasks found).');
    }
  } finally {
    db.close();
  }
  
  process.exit(0);
}

main();
