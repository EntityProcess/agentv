interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /** Additional environment variables to pass to the subprocess */
  readonly env?: Record<string, string>;
}

function shellEscapePath(value: string): string {
  if (process.platform === 'win32') {
    // Very small escape helper for file paths in cmd.exe context.
    // Wrap in double-quotes and escape existing double-quotes.
    return `"${value.replaceAll('"', '""')}"`;
  }
  // POSIX: single-quote escape (close/open around embedded single quotes).
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

export async function execFileWithStdin(
  argv: readonly string[],
  stdinPayload: string,
  options: ExecOptions = {},
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  if (argv.length === 0) {
    throw new Error('Executable argv must include at least one entry');
  }

  // Use Bun.spawn if available, otherwise fall back to Node.js child_process
  if (typeof Bun !== 'undefined') {
    return execFileWithStdinBun(argv, stdinPayload, options);
  }
  return execFileWithStdinNode(argv, stdinPayload, options);
}

/**
 * Bun implementation using Bun.spawn
 */
async function execFileWithStdinBun(
  argv: readonly string[],
  stdinPayload: string,
  options: ExecOptions,
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const command = [...argv];
  const encoder = new TextEncoder();
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: encoder.encode(stdinPayload),
    stdout: 'pipe',
    stderr: 'pipe',
    // Merge additional env vars with process.env
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });

  let timedOut = false;
  const timeout =
    options.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;

  try {
    const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve('');
    const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve('');

    const [stdout, stderr, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      proc.exited,
    ]);

    if (timedOut) {
      throw new Error(`Process timed out after ${options.timeoutMs}ms`);
    }

    return {
      stdout: stdout.replace(/\r\n/g, '\n'),
      stderr: stderr.replace(/\r\n/g, '\n'),
      exitCode,
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Node.js implementation using child_process.spawn
 */
async function execFileWithStdinNode(
  argv: readonly string[],
  stdinPayload: string,
  options: ExecOptions,
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Merge additional env vars with process.env
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let timedOut = false;
    const timeout =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : undefined;

    child.on('error', (error) => {
      if (timeout !== undefined) clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (timeout !== undefined) clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8').replace(/\r\n/g, '\n');
      const stderr = Buffer.concat(stderrChunks).toString('utf8').replace(/\r\n/g, '\n');

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    // Write stdin and close
    if (child.stdin) {
      child.stdin.write(stdinPayload);
      child.stdin.end();
    }
  });
}

/**
 * Execute a shell command with the given stdin payload.
 *
 * Why this exists:
 * - Some providers/scripts (notably Node.js) must receive stdin reliably.
 * - In some Bun environments, `Bun.spawn` does not forward stdin to Node correctly.
 * - Capture stdout/stderr via temp files to avoid pipe incompatibilities.
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
  const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { randomUUID } = await import('node:crypto');

  const dir = path.join(tmpdir(), `agentv-exec-${randomUUID()}`);
  await mkdir(dir, { recursive: true });

  const stdinPath = path.join(dir, 'stdin.txt');
  const stdoutPath = path.join(dir, 'stdout.txt');
  const stderrPath = path.join(dir, 'stderr.txt');

  await writeFile(stdinPath, stdinPayload, 'utf8');

  const wrappedCommand =
    process.platform === 'win32'
      ? `(${command}) < ${shellEscapePath(stdinPath)} > ${shellEscapePath(stdoutPath)} 2> ${shellEscapePath(stderrPath)}`
      : `(${command}) < ${shellEscapePath(stdinPath)} > ${shellEscapePath(stdoutPath)} 2> ${shellEscapePath(stderrPath)}`;

  const { spawn } = await import('node:child_process');
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(wrappedCommand, {
        shell: true,
        cwd: options.cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
        // Merge additional env vars with process.env
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });

      const timeout = options.timeoutMs
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`Process timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : undefined;

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
        resolve(code ?? 0);
      });
    });

    const stdout = (await readFile(stdoutPath, 'utf8')).replace(/\r\n/g, '\n');
    const stderr = (await readFile(stderrPath, 'utf8')).replace(/\r\n/g, '\n');
    return { stdout, stderr, exitCode };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
