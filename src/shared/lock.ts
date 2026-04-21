import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot, loadConfig } from './config.js';
import { appendError } from './state.js';

const LOCK_FILE = 'state/.lock';
const DEFAULT_MAX_RUN_MINUTES = 60;

function lockPath(): string {
  return resolve(getProjectRoot(), LOCK_FILE);
}

export interface LockInfo {
  pid: number;
  label: string;
  since: string;
}

/** Returns true if a process with the given PID is running, false if it is dead. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, does not kill
    return true;
  } catch {
    return false;
  }
}

/** Returns the age of a lock in minutes given its ISO acquiredAt timestamp. */
function lockAgeMinutes(since: string): number {
  const acquiredAt = new Date(since).getTime();
  if (isNaN(acquiredAt)) return Infinity;
  return (Date.now() - acquiredAt) / (1000 * 60);
}

/** Returns true if lock acquired. False if another live process holds it. */
export function acquireLock(label: string): boolean {
  const path = lockPath();

  if (existsSync(path)) {
    const lines = readFileSync(path, 'utf-8').split('\n');
    const pid = parseInt(lines[0] ?? '', 10);
    const since = lines[2] ?? '';

    if (!isNaN(pid)) {
      const alive = isPidAlive(pid);

      if (alive) {
        // Lock is held by a live process — never reclaim regardless of age.
        return false;
      }

      // PID is dead. Check age against the stale-lock threshold.
      let maxRunMinutes = DEFAULT_MAX_RUN_MINUTES;
      try {
        const config = loadConfig();
        maxRunMinutes = config.pipeline.maxRunMinutes ?? DEFAULT_MAX_RUN_MINUTES;
      } catch {
        // Config unreadable — use default. Do not crash the lock path.
      }

      const ageMin = lockAgeMinutes(since);
      const threshold = maxRunMinutes * 2;

      if (ageMin > threshold) {
        // Stale lock from a dead process that exceeded the max run window.
        // Reclaim and log to errors.json so the operator can see it.
        console.log(
          `[lock] Reclaiming stale lock: pid=${pid} label="${lines[1] ?? ''}" age=${Math.round(ageMin)}m threshold=${threshold}m`,
        );
        appendError({
          timestamp: new Date().toISOString(),
          agent: 'lock',
          level: 'info',
          message: `Reclaimed stale lock from dead process pid=${pid} (age ${Math.round(ageMin)}m > threshold ${threshold}m). Prior label: "${lines[1] ?? ''}"`,
        });
        // Fall through to acquire below.
      } else {
        // Dead PID but lock is still within the expected run window — respect it.
        // The process may have just crashed; another instance should not silently
        // take over mid-pipeline.
        console.log(
          `[lock] Lock held by dead pid=${pid} but still within run window (age=${Math.round(ageMin)}m < threshold=${threshold}m). Blocking.`,
        );
        return false;
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
