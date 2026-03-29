import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getProjectRoot } from './config.js';
import type {
  QueuedProduct,
  VideoQueueItem,
  PostedVideo,
  LastRun,
  PipelineError,
  ResearchLogEntry,
  AnalystSignals,
} from './types.js';

function statePath(filename: string): string {
  const dir = resolve(getProjectRoot(), 'state');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return resolve(dir, filename);
}

function readJson<T>(filename: string, fallback: T): T {
  const path = statePath(filename);
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as T;
}

function writeJson<T>(filename: string, data: T): void {
  writeFileSync(statePath(filename), JSON.stringify(data, null, 2), 'utf-8');
}

// Product queue
export function readProductQueue(): QueuedProduct[] {
  return readJson('product-queue.json', []);
}

export function writeProductQueue(products: QueuedProduct[]): void {
  writeJson('product-queue.json', products);
}

// Video queue
export function readVideoQueue(): VideoQueueItem[] {
  return readJson('video-queue.json', []);
}

export function writeVideoQueue(items: VideoQueueItem[]): void {
  writeJson('video-queue.json', items);
}

// Posted log
export function readPosted(): PostedVideo[] {
  return readJson('posted.json', []);
}

export function writePosted(posts: PostedVideo[]): void {
  writeJson('posted.json', posts);
}

// Research log
export function readResearchLog(): ResearchLogEntry[] {
  return readJson('research-log.json', []);
}

export function writeResearchLog(entries: ResearchLogEntry[]): void {
  writeJson('research-log.json', entries);
}

// Last run
export function readLastRun(): LastRun | null {
  return readJson<LastRun | null>('last-run.json', null);
}

export function writeLastRun(run: LastRun): void {
  writeJson('last-run.json', run);
}

// Errors
export function readErrors(): PipelineError[] {
  return readJson('errors.json', []);
}

export function appendError(error: PipelineError): void {
  const errors = readErrors();
  errors.push(error);
  writeJson('errors.json', errors);
}

const ERROR_RETENTION_DAYS = 7;

export function trimErrors(): void {
  const errors = readErrors();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ERROR_RETENTION_DAYS);
  const trimmed = errors.filter((e) => new Date(e.timestamp) > cutoff);
  if (trimmed.length < errors.length) {
    console.log(`[state] Trimmed ${errors.length - trimmed.length} errors older than ${ERROR_RETENTION_DAYS} days`);
    writeJson('errors.json', trimmed);
  }
}

// Analyst signals
export function readAnalystSignals(): AnalystSignals | null {
  return readJson<AnalystSignals | null>('analyst-signals.json', null);
}

export function writeAnalystSignals(signals: AnalystSignals): void {
  writeJson('analyst-signals.json', signals);
}
