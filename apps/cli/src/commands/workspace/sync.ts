import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { type WorkspaceMode, type WorkspaceSource, readWorkspaceConfig } from './config.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeRm(targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) return;
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function ensureParentDir(targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function copyPath(sourcePath: string, destPath: string): Promise<void> {
  await safeRm(destPath);
  await ensureParentDir(destPath);
  await fs.cp(sourcePath, destPath, { recursive: true });
}

async function symlinkPath(sourcePath: string, destPath: string): Promise<void> {
  await safeRm(destPath);
  await ensureParentDir(destPath);

  const st = await fs.lstat(sourcePath);
  const isDir = st.isDirectory();

  // Windows: prefer junctions for directories.
  if (process.platform === 'win32' && isDir) {
    await fs.symlink(sourcePath, destPath, 'junction');
    return;
  }

  await fs.symlink(sourcePath, destPath, isDir ? 'dir' : 'file');
}

function resolveWorkspaceDest(
  workspaceRoot: string,
  source: WorkspaceSource,
  includePath: string,
): string {
  const destBase = source.dest ? path.resolve(workspaceRoot, source.dest) : workspaceRoot;
  return path.resolve(destBase, includePath);
}

function resolveLocalSourcePath(
  configDir: string,
  sourceRoot: string,
  includePath: string,
): string {
  const resolvedRoot = path.isAbsolute(sourceRoot)
    ? sourceRoot
    : path.resolve(configDir, sourceRoot);
  return path.resolve(resolvedRoot, includePath);
}

async function runGit(args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`git ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function ensureGitSparseCheckout(opts: {
  repo: string;
  ref?: string;
  includes: readonly string[];
  checkoutDir: string;
}): Promise<void> {
  const { repo, ref, includes, checkoutDir } = opts;

  await fs.mkdir(checkoutDir, { recursive: true });

  const gitDir = path.join(checkoutDir, '.git');
  const isRepo = await pathExists(gitDir);

  if (!isRepo) {
    await runGit(['init'], checkoutDir);
    await runGit(['remote', 'add', 'origin', repo], checkoutDir);
  } else {
    // If origin changed, update it.
    await runGit(['remote', 'set-url', 'origin', repo], checkoutDir);
  }

  await runGit(['config', 'core.sparseCheckout', 'true'], checkoutDir);

  const infoDir = path.join(gitDir, 'info');
  await fs.mkdir(infoDir, { recursive: true });
  const sparseFile = path.join(infoDir, 'sparse-checkout');

  // Git sparse patterns use forward slashes.
  const patterns = includes
    .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((p) => p.length > 0)
    .map((p) => `${p}/`);

  await fs.writeFile(sparseFile, `${patterns.join('\n')}\n`, 'utf8');

  // Fetch just the ref we need (or default).
  if (ref) {
    await runGit(['fetch', '--depth=1', 'origin', ref], checkoutDir);
    await runGit(['checkout', '--force', 'FETCH_HEAD'], checkoutDir);
  } else {
    await runGit(['fetch', '--depth=1', 'origin'], checkoutDir);
    // If the repo already has HEAD, checkout it. Otherwise, use origin/HEAD.
    await runGit(['checkout', '--force', 'FETCH_HEAD'], checkoutDir);
  }

  await runGit(['read-tree', '-mu', 'HEAD'], checkoutDir);
}

async function syncLocalSource(opts: {
  mode: WorkspaceMode;
  configDir: string;
  workspaceRoot: string;
  source: Extract<WorkspaceSource, { type: 'local' }>;
}): Promise<void> {
  const { mode, configDir, workspaceRoot, source } = opts;

  for (const includePath of source.include) {
    const from = resolveLocalSourcePath(configDir, source.root, includePath);
    const to = resolveWorkspaceDest(workspaceRoot, source, includePath);

    if (!(await pathExists(from))) {
      throw new Error(`Local source path not found: ${from}`);
    }

    if (mode === 'symlink') {
      await symlinkPath(from, to);
    } else {
      await copyPath(from, to);
    }
  }
}

async function syncGitSource(opts: {
  mode: WorkspaceMode;
  workspaceRoot: string;
  cacheRoot: string;
  source: Extract<WorkspaceSource, { type: 'git' }>;
}): Promise<void> {
  const { mode, workspaceRoot, cacheRoot, source } = opts;

  const checkoutDir = path.join(cacheRoot, 'git', source.id);

  await ensureGitSparseCheckout({
    repo: source.repo,
    ref: source.ref,
    includes: source.include,
    checkoutDir,
  });

  for (const includePath of source.include) {
    const from = path.resolve(checkoutDir, includePath);
    const to = resolveWorkspaceDest(workspaceRoot, source, includePath);

    if (!(await pathExists(from))) {
      throw new Error(`Git source path not found after checkout: ${from}`);
    }

    if (mode === 'symlink') {
      await symlinkPath(from, to);
    } else {
      await copyPath(from, to);
    }
  }
}

export async function workspaceSyncCommand(args: {
  config: string;
  mode?: WorkspaceMode;
}): Promise<void> {
  const { config: configPath, mode: modeOverride } = args;

  const { config, configDir, workspaceRoot } = await readWorkspaceConfig(configPath);

  const mode = modeOverride ?? config.mode ?? 'copy';
  const cacheRoot = path.resolve(workspaceRoot, '.agentv', 'cache');

  await fs.mkdir(cacheRoot, { recursive: true });

  for (const source of config.sources) {
    if (source.type === 'local') {
      await syncLocalSource({
        mode,
        configDir,
        workspaceRoot,
        source,
      });
      continue;
    }

    await syncGitSource({
      mode,
      workspaceRoot,
      cacheRoot,
      source,
    });
  }
}
