/**
 * Shared self-update logic for agentv.
 *
 * Used by both `agentv self update` and the version-check prompt
 * when the installed version doesn't satisfy `required_version`.
 *
 * When called from the version-check prompt, a `versionRange` (from the
 * project's `required_version` config) is passed through as the npm/bun
 * version specifier (e.g., `agentv@">=4.1.0"`). This ensures the update
 * respects the project's constraints and avoids unintended major-version jumps.
 *
 * When called from `agentv self update` (no range), it installs `@latest`.
 *
 * Install scope detection: if `process.argv[1]` contains `node_modules`,
 * agentv was invoked from a local project dependency (e.g. `npx agentv` or
 * `node_modules/.bin/agentv`); update the local dep instead of the global
 * install. Otherwise, update globally (default).
 *
 * Package-manager command resolution prefers runtime-adjacent executables
 * (for example Node's bundled npm-cli.js or the current Bun executable)
 * before falling back to PATH. This keeps self-update working in shells
 * where `agentv` is reachable but `npm`/`bun` are not on PATH.
 *
 * To add a new package manager: add a case to `detectPackageManagerFromPath()`
 * and a corresponding install-args / resolver entry below.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { get } from 'node:https';
import { basename, dirname, join, win32 } from 'node:path';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/agentv/latest';

/**
 * Detect package manager from the script path.
 * If the path contains '.bun', it was installed via bun; otherwise assume npm.
 */
export function detectPackageManagerFromPath(scriptPath: string): 'bun' | 'npm' {
  if (scriptPath.includes('.bun')) {
    return 'bun';
  }
  return 'npm';
}

export function detectPackageManager(): 'bun' | 'npm' {
  return detectPackageManagerFromPath(process.argv[1] ?? '');
}

/**
 * Detect whether agentv was invoked from a local project install.
 * A path containing a `node_modules` segment indicates a local dependency;
 * anything else (system binary, `.bun/bin`, `.nvm/.../bin`) is treated as
 * global. Matches both POSIX and Windows path separators so a directory
 * that merely embeds the substring (e.g., `/opt/my_node_modules_tool/`)
 * isn't misclassified.
 */
export function detectInstallScopeFromPath(scriptPath: string): 'local' | 'global' {
  const hasSegment =
    scriptPath.includes('/node_modules/') || scriptPath.includes('\\node_modules\\');
  return hasSegment ? 'local' : 'global';
}

export function detectInstallScope(): 'local' | 'global' {
  return detectInstallScopeFromPath(process.argv[1] ?? '');
}

function runCommand(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    // No shell: true — args are passed directly to execvp, avoiding shell
    // interpretation of semver operators (>, <, |) in version ranges.
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data);
      stdout += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}

/**
 * Fetch the latest published version of agentv from the npm registry.
 * Returns null on network errors or timeouts (best-effort).
 */
export function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = get(NPM_REGISTRY_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const version = JSON.parse(body).version;
          resolve(typeof version === 'string' ? version : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

export function getInstallArgs(
  pm: 'bun' | 'npm',
  versionSpec: string,
  scope: 'local' | 'global',
): string[] {
  const pkg = `agentv@${versionSpec}`;
  const baseCmd = pm === 'npm' ? 'install' : 'add';
  return scope === 'global' ? [baseCmd, '-g', pkg] : [baseCmd, pkg];
}

function findBundledNpmCli(
  execPath: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string | undefined {
  const pathApi = platform === 'win32' ? win32 : { dirname, join };
  const execDir = pathApi.dirname(execPath);
  const candidates =
    platform === 'win32'
      ? [pathApi.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [
          pathApi.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          pathApi.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        ];

  return candidates.find((candidate) => exists(candidate));
}

export function resolvePackageManagerCommand(
  pm: 'bun' | 'npm',
  args: string[],
  options?: {
    execPath?: string;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
  },
): { cmd: string; args: string[] } {
  const execPath = options?.execPath ?? process.execPath;
  const platform = options?.platform ?? process.platform;
  const exists = options?.exists ?? existsSync;
  const pathApi = platform === 'win32' ? win32 : { basename };

  if (pm === 'bun') {
    const runtimeName = pathApi.basename(execPath).toLowerCase();
    if ((runtimeName === 'bun' || runtimeName === 'bun.exe') && exists(execPath)) {
      return { cmd: execPath, args };
    }
    return { cmd: 'bun', args };
  }

  const npmCliPath = findBundledNpmCli(execPath, platform, exists);
  if (npmCliPath) {
    return { cmd: execPath, args: [npmCliPath, ...args] };
  }

  return { cmd: 'npm', args };
}

/**
 * Run the self-update flow: install agentv using the detected (or specified)
 * package manager, scoped to the detected install location (global by default,
 * local when invoked from a project's `node_modules`).
 *
 * @param options.pm - Force a specific package manager
 * @param options.currentVersion - Current installed version (for display)
 * @param options.versionRange - Semver range from config (e.g., ">=4.1.0").
 *   When provided, used as the npm/bun version specifier so the update
 *   stays within the project's constraints. When omitted, installs `@latest`.
 * @param options.scope - Force local or global install. Defaults to
 *   auto-detection based on `process.argv[1]`.
 */
export async function performSelfUpdate(options?: {
  pm?: 'bun' | 'npm';
  currentVersion?: string;
  versionRange?: string;
  scope?: 'local' | 'global';
}): Promise<{
  success: boolean;
  currentVersion: string;
  newVersion?: string;
  scope: 'local' | 'global';
}> {
  const pm = options?.pm ?? detectPackageManager();
  const currentVersion = options?.currentVersion ?? 'unknown';
  const versionSpec = options?.versionRange ?? 'latest';
  const scope = options?.scope ?? detectInstallScope();

  const args = getInstallArgs(pm, versionSpec, scope);
  const command = resolvePackageManagerCommand(pm, args);

  try {
    const result = await runCommand(command.cmd, command.args);

    if (result.exitCode !== 0) {
      return { success: false, currentVersion, scope };
    }

    // Best-effort version check after update
    let newVersion: string | undefined;
    try {
      const versionResult = await runCommand('agentv', ['--version']);
      newVersion = versionResult.stdout.trim();
    } catch {
      // Ignore - version check is best-effort
    }

    return { success: true, currentVersion, newVersion, scope };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('not found')) {
        const alternative = pm === 'npm' ? 'bun' : 'npm';
        console.error(`Error: ${pm} not found. Try using --${alternative} flag.`);
      } else {
        console.error(`Error: ${error.message}`);
      }
    }
    return { success: false, currentVersion, scope };
  }
}
