/**
 * Session hook execution for AgentV.
 *
 * Runs a shell command once at agentv startup and injects exported environment
 * variables into the current process. This lets projects fetch secrets at
 * runtime (e.g. from a vault) without needing a wrapper script.
 *
 * ## How it works
 *
 * 1. The command is run via `sh -c` (or `cmd /c` on Windows).
 * 2. stdout is captured and parsed for env var exports.
 * 3. stderr is forwarded to the process stderr so the user sees output.
 * 4. Non-zero exit aborts with a clear error.
 * 5. Parsed keys are injected into `process.env` — only for keys not already
 *    set, so existing env always wins.
 *
 * ## Supported output formats
 *
 * Both shell-export and dotenv formats are accepted:
 *   export KEY="value"   (shell export — quotes optional)
 *   KEY=value            (dotenv — no export prefix)
 *
 * Lines that don't match either pattern are silently ignored.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';

const ANSI_YELLOW = '[33m';
const ANSI_RESET = '[0m';

/**
 * Parse env var lines from hook stdout.
 *
 * Accepts:
 *   export KEY="value"   → { KEY: "value" }
 *   export KEY=value     → { KEY: "value" }
 *   KEY=value            → { KEY: "value" }
 *
 * Strips surrounding single or double quotes from values.
 * Skips lines with empty keys or values that look like shell syntax.
 */
export function parseEnvOutput(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match: [export ]KEY=value
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Run the before_session hook command and inject exported env vars into process.env.
 *
 * - Runs via shell (`sh -c` on POSIX, `cmd /c` on Windows)
 * - Captured stdout is parsed for env vars; stderr is forwarded to process.stderr
 * - Non-zero exit throws an Error with the command and exit code
 * - Keys already set in process.env are NOT overwritten
 *
 * @param command Shell command string to execute
 */
export function runBeforeSessionHook(command: string): void {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd' : 'sh';
  const shellFlag = isWindows ? '/c' : '-c';

  console.log(`${ANSI_YELLOW}Running before_session hook: ${command}${ANSI_RESET}`);

  const result = spawnSync(shell, [shellFlag, command], {
    encoding: 'utf8',
    // Do not inherit stdio — capture stdout for parsing, forward stderr manually
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Forward stderr so the user can see hook output (warnings, progress, etc.)
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw new Error(`before_session hook failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `before_session hook exited with code ${result.status ?? 'unknown'}: ${command}`,
    );
  }

  const vars = parseEnvOutput(result.stdout ?? '');
  let injected = 0;

  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      injected++;
    }
  }

  if (injected > 0) {
    console.log(`before_session hook injected ${injected} environment variable(s).`);
  }
}
