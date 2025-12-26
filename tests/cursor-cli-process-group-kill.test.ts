// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * These tests specifically target the "orphaned subprocess" failure mode:
 * when cursor-cli times out, it may leave descendants running if we only signal the direct child.
 *
 * The fix is to spawn cursor-cli as a process-group leader (POSIX) and on timeouts
 * send signals to the whole group via `process.kill(-pid, signal)`.
 */

const mockSpawn = jest.fn();

// Mock core spawn used by CursorCLI (must be registered before CursorCLI is imported).
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

type MockChild = {
  pid: number;
  // Use loose typing for Jest mocks here; ts-jest + ESM can be strict about Mock<UnknownFunction>.
  stdout: { on: any };
  stderr: { on: any };
  on: any;
  kill: any;
  __handlers: {
    stdoutData: Array<(data: Buffer) => void>;
    stderrData: Array<(data: Buffer) => void>;
    close: Array<(code: number | null) => void>;
    error: Array<(err: Error) => void>;
  };
};

function createMockChild(pid = 4242): MockChild {
  const handlers: MockChild['__handlers'] = {
    stdoutData: [],
    stderrData: [],
    close: [],
    error: [],
  };

  const child: Partial<MockChild> = {};

  child.pid = pid;
  child.kill = jest.fn();
  child.stdout = {
    on: jest.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') handlers.stdoutData.push(cb);
      return child.stdout as any;
    }),
  };
  child.stderr = {
    on: jest.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') handlers.stderrData.push(cb);
      return child.stderr as any;
    }),
  };
  child.on = jest.fn((event: string, cb: any) => {
    if (event === 'close') handlers.close.push(cb);
    if (event === 'error') handlers.error.push(cb);
    return child as any;
  });
  child.__handlers = handlers;

  return child as MockChild;
}

describe('CursorCLI process-group termination', () => {
  let CursorCLI: typeof import('../src/cursor-cli.js').CursorCLI;

  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(async () => {
    jest.resetModules();
    mockSpawn.mockReset();

    // Snapshot env and ensure we don't use PTY in these tests (PTY has different semantics for process groups)
    envSnapshot = { ...process.env };
    process.env.CURSOR_RUNNER_USE_PTY = 'false';

    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    ({ CursorCLI } = await import('../src/cursor-cli.js'));
  });

  afterEach(() => {
    // Restore environment without reassigning process.env (can be non-writable in some runtimes)
    for (const key of Object.keys(process.env)) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value !== undefined) process.env[key] = value;
    }
    jest.useRealTimers();
  });

  it('spawns cursor-cli detached on POSIX so we can kill the process group', async () => {
    jest.useFakeTimers();
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    const cli = new CursorCLI('/fake/cursor');
    const p = cli.executeCommand(['--version'], { timeout: 50 });

    // Allow async import/initialization to progress and spawn() to be called.
    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalled();
    const spawnOptions = mockSpawn.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(spawnOptions).toBeDefined();
    if (process.platform === 'win32') {
      expect(spawnOptions?.detached).toBe(false);
    } else {
      expect(spawnOptions?.detached).toBe(true);
    }

    // Clean up: force timeout to settle promise.
    jest.advanceTimersByTime(50);
    await expect(p).rejects.toThrow(/timeout/i);
  });

  it('kills the cursor-cli process group on hard timeout (SIGTERM then SIGKILL)', async () => {
    jest.useFakeTimers();

    const child = createMockChild(9001);
    mockSpawn.mockReturnValue(child);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    const cli = new CursorCLI('/fake/cursor');
    const p = cli.executeCommand(['--model', 'x'], { timeout: 100 });

    // Let spawn happen.
    await Promise.resolve();

    // Trigger hard timeout.
    jest.advanceTimersByTime(100);
    await expect(p).rejects.toThrow(/Command timeout/i);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Escalate to SIGKILL.
    jest.advanceTimersByTime(1000);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    killSpy.mockRestore();
  });

  it('kills the cursor-cli process group on idle timeout (no output)', async () => {
    jest.useFakeTimers();

    // Make idle timeout extremely small so the first 30s heartbeat triggers it
    process.env.CURSOR_CLI_IDLE_TIMEOUT = '1';

    const child = createMockChild(9100);
    mockSpawn.mockReturnValue(child);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    const cli = new CursorCLI('/fake/cursor');
    const p = cli.executeCommand(['--model', 'x'], { timeout: 600_000 });

    await Promise.resolve();

    // Emit one chunk of output so idle timeout becomes "armed", then go silent.
    // Heartbeat runs every 30s; after 30s with no output, idle timeout should fire.
    expect(child.__handlers.stdoutData.length).toBeGreaterThan(0);
    child.__handlers.stdoutData[0](Buffer.from('started'));

    jest.advanceTimersByTime(30_000);

    await expect(p).rejects.toThrow(/No output from cursor-cli/i);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Escalate to SIGKILL.
    jest.advanceTimersByTime(1000);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    killSpy.mockRestore();
  });

  it('kills the cursor-cli process group when output size exceeds the limit', async () => {
    jest.useFakeTimers();

    // Tiny output limit for deterministic test
    process.env.CURSOR_CLI_MAX_OUTPUT_SIZE = '5';

    const child = createMockChild(9200);
    mockSpawn.mockReturnValue(child);

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    const cli = new CursorCLI('/fake/cursor');
    const p = cli.executeCommand(['--model', 'x'], { timeout: 600_000 });

    await Promise.resolve();

    // Emit stdout data exceeding the limit (5 bytes)
    expect(child.__handlers.stdoutData.length).toBeGreaterThan(0);
    child.__handlers.stdoutData[0](Buffer.from('0123456789'));

    await expect(p).rejects.toThrow(/Output size exceeded/i);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGTERM');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Escalate to SIGKILL.
    jest.advanceTimersByTime(1000);

    if (process.platform !== 'win32') {
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    killSpy.mockRestore();
  });
});
