import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from './config.js';

const LOCK_FILE = 'state/.lock';

function lockPath(): string {
  return resolve(getProjectRoot(), LOCK_FILE);
}

export interface LockInfo {
  pid: number;
  label: string;
  since: string;
}

/** Returns true if lock acquired. False if another live process holds it. */
export function acquireLock(label: string): boolean {
  const path = lockPath();

  if (existsSync(path)) {
    const content = readFileSync(path, 'utf-8');
    const pid = parseInt(content.split('\n')[0] ?? '', 10);

    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // signal 0 = existence check, doesn't kill
        return false;          // process alive, lock held
      } catch {
        // Process dead, stale lock — fall through to acquire
        console.log(`[lock] Removing stale lock from dead process ${pid}`);
      }
    }
  }

  writeFileSync(path, `${process.pid}\n${label}\n${new Date().toISOString()}`, 'utf-8');
  return true;
}

export function releaseLock(): void {
  const path = lockPath();
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf-8');
  const pid = parseInt(content.split('\n')[0] ?? '', 10);

  // Only release if we own it
  if (pid === process.pid) {
    unlinkSync(path);
  }
}

export function getLockInfo(): LockInfo | null {
  const path = lockPath();
  if (!existsSync(path)) return null;

  const lines = readFileSync(path, 'utf-8').split('\n');
  const pid = parseInt(lines[0] ?? '', 10);
  if (isNaN(pid)) return null;

  return {
    pid,
    label: lines[1] ?? '',
    since: lines[2] ?? '',
  };
}
