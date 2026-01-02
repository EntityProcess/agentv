interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

function getBunSpawn():
  | ((options: {
      cmd: readonly string[];
      cwd?: string;
      stdin: Uint8Array;
      stdout: 'pipe';
      stderr: 'pipe';
    }) => {
      stdout: ReadableStream;
      stderr: ReadableStream;
      exited: Promise<number>;
      kill: () => void;
    })
  | undefined {
  const bunSpawn = (globalThis as { Bun?: { spawn?: unknown } }).Bun?.spawn;
  return typeof bunSpawn === 'function' ? (bunSpawn as ReturnType<typeof getBunSpawn>) : undefined;
}

/**
 * Execute a shell command with the given stdin payload.
 *
 * Why this exists:
 * - Under Bun, using `node:child_process` to pipe stdin to a subprocess can be unreliable.
 * - Bun's native `Bun.spawn` reliably passes stdin and returns stdout/stderr streams.
 * - Under Node, fall back to `node:child_process` for compatibility.
 */
export async function execShellWithStdin(
  command: string,
  stdinPayload: string,
  options: ExecOptions = {},
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const bunSpawn = getBunSpawn();
  if (bunSpawn) {
    const encoder = new TextEncoder();
    // Use platform-appropriate shell
    const isWindows = process.platform === 'win32';
    const shellCmd = isWindows ? ['cmd.exe', '/c', command] : ['sh', '-c', command];
    
    const proc = bunSpawn({
      cmd: shellCmd,
      cwd: options.cwd,
      stdin: encoder.encode(stdinPayload),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          proc.kill();
        }, options.timeoutMs)
      : undefined;

    try {
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  const { spawn } = await import('node:child_process');
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.stdin?.write(stdinPayload);
    child.stdin?.end();
  });
}
