import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger the module
// ---------------------------------------------------------------------------
const {
  mockReadFileSync,
  mockWriteFileSync,
  mockExistsSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

const { mockAppendError } = vi.hoisted(() => ({
  mockAppendError: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock('../config.js', () => ({
  getProjectRoot: () => '/tmp/tt-auto-lock-test',
  loadConfig: () => ({
    pipeline: {
      productsPerRun: 5,
      videoFormats: ['voiceover'],
      autoSelectFormat: true,
      maxRunMinutes: 60,
    },
  }),
}));

vi.mock('../state.js', () => ({
  appendError: mockAppendError,
}));

import { acquireLock } from '../lock.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the 3-line lock file content. */
function makeLockContent(pid: number, label: string, ageMinutes: number): string {
  const since = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return `${pid}\n${label}\n${since}`;
}

/** A PID that is guaranteed not to exist on this machine (fake dead process). */
const DEAD_PID = 9_999_999;

/** The current live process PID — guaranteed alive. */
const LIVE_PID = process.pid;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('acquireLock — stale-lock detection', () => {
  beforeEach(() => {
    vi.spyOn(process, 'kill');
    mockWriteFileSync.mockClear();
    mockAppendError.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('(a) fresh lock held by a live PID blocks acquisition', () => {
    // Lock is 5 minutes old — well within threshold — and PID is alive.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeLockContent(LIVE_PID, 'pipeline', 5));

    // process.kill(pid, 0) succeeds for the current process (it is alive).
    vi.spyOn(process, 'kill').mockImplementation((_pid, _sig) => true);

    const result = acquireLock('test-caller');

    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockAppendError).not.toHaveBeenCalled();
  });

  it('(b) stale lock held by a dead PID past the age threshold is reclaimed', () => {
    // Lock is 130 minutes old. threshold = 60 * 2 = 120 minutes. Age > threshold → reclaim.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeLockContent(DEAD_PID, 'pipeline', 130));

    // process.kill(DEAD_PID, 0) throws ESRCH — process does not exist.
    vi.spyOn(process, 'kill').mockImplementation((_pid, _sig) => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });

    const result = acquireLock('test-caller');

    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();

    // The new lock content written to disk should use the current PID.
    const written: string = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(written).toContain(`${process.pid}`);
    expect(written).toContain('test-caller');

    // An info-level error should be appended to errors.json.
    expect(mockAppendError).toHaveBeenCalledOnce();
    const errorArg = mockAppendError.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(errorArg.agent).toBe('lock');
    expect(errorArg.level).toBe('info');
    expect(typeof errorArg.message).toBe('string');
    expect(errorArg.message).toContain(`pid=${DEAD_PID}`);
  });

  it('(c) fresh lock held by a dead PID is still respected when age is below threshold', () => {
    // Lock is 10 minutes old. threshold = 120 minutes. Age < threshold → block.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeLockContent(DEAD_PID, 'pipeline', 10));

    // process.kill(DEAD_PID, 0) throws — PID is dead.
    vi.spyOn(process, 'kill').mockImplementation((_pid, _sig) => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });

    const result = acquireLock('test-caller');

    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    // No error logged — this is a normal in-window block, not a stale reclaim.
    expect(mockAppendError).not.toHaveBeenCalled();
  });
});
