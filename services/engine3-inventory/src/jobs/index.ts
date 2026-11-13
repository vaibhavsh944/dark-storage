import Database from 'better-sqlite3';
import { runLeaseSweep } from './leaseSweep.js';

let sweepTimer: NodeJS.Timeout | null = null;

export function startBackgroundJobs(db: Database.Database, intervalMs = 15000): void {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    try {
      runLeaseSweep(db);
    } catch (err) {
      console.error('[jobs] Error running lease sweep:', err);
    }
  }, intervalMs);

  sweepTimer.unref();
}

export function stopBackgroundJobs(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export { runLeaseSweep };
