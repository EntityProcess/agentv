/**
 * Shared self-update logic for agentv.
 *
 * Used only by the explicit `agentv self update` command. Project
 * `required_version` checks are advisory and never invoke this module.
 *
 * By default it installs `@latest` for stable versions or `@next` when the
 * current version has a prerelease identifier. Callers may pass a
 * `versionRange`/dist tag when they need a specific install specifier.
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

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org/agentv/';

/** Returns 'next' if the version has a prerelease identifier, 'latest' otherwise. */
export function getDistTagForVersion(version: string): 'next' | 'latest' {
  return version.includes('-') ? 'next' : 'latest';
}

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
 * npm global installs can also live under a `node_modules` segment, so
 * the path alone is not enough. We treat `npx` cache paths as local and
 * otherwise require the current working directory to be inside the package
 * root before classifying it as local.
 */
export function detectInstallScopeFromPath(
  scriptPath: string,
  cwd = process.cwd(),
): 'local' | 'global' {
  const normalizedScriptPath = scriptPath.replace(/\\/g, '/');
  const normalizedCwd = cwd.replace(/\\/g, '/');

  if (!normalizedScriptPath.includes('/node_modules/')) {
    return 'global';
  }

  if (
    normalizedScriptPath.includes('/.npm/_npx/') ||
    normalizedScriptPath.includes('/npm-cache/_npx/')
  ) {
    return 'local';
  }

  const packageRoot = normalizedScriptPath.split('/node_modules/')[0];
  if (!packageRoot) {
    return 'global';
  }

  const scriptPathComparable =
    process.platform === 'win32' ? normalizedScriptPath.toLowerCase() : normalizedScriptPath;
  const cwdComparable = process.platform === 'win32' ? normalizedCwd.toLowerCase() : normalizedCwd;
  const packageRootComparable =
    process.platform === 'win32' ? packageRoot.toLowerCase() : packageRoot;

  const projectOwnsPackage =
    cwdComparable === packageRootComparable ||
    cwdComparable.startsWith(`${packageRootComparable}/`);

  return projectOwnsPackage ? 'local' : 'global';
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
 * Pass distTag='next' for prerelease channels. Returns null on network errors.
 */
export function fetchLatestVersion(distTag: 'latest' | 'next' = 'latest'): Promise<string | null> {
  return new Promise((resolve) => {
    const req = get(`${NPM_REGISTRY_BASE}${distTag}`, { timeout: 5000 }, (res) => {
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
  const versionSpec =
    options?.versionRange ??
    getDistTagForVersion(currentVersion === 'unknown' ? '' : currentVersion);
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
