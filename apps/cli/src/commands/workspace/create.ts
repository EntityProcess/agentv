import fs from 'node:fs/promises';
import path from 'node:path';

import { writeDefaultWorkspaceConfig } from './config.js';

function makeTimestampedWorkspaceDir(cwd: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(cwd, '.agentv', 'workspaces', timestamp);
}

async function isNonEmptyDir(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function workspaceCreateCommand(args: {
  out?: string;
  workspaceRoot?: string;
  config?: string;
  force?: boolean;
}): Promise<{ readonly workspaceRoot: string; readonly configPath: string }> {
  const cwd = process.cwd();

  const out = args.out?.trim();
  const workspaceRootArg = args.workspaceRoot?.trim();
  if (out && workspaceRootArg && path.resolve(out) !== path.resolve(workspaceRootArg)) {
    throw new Error('Provide only one of --out or --workspace-root (they are aliases).');
  }

  const workspaceRoot = path.resolve(workspaceRootArg ?? out ?? makeTimestampedWorkspaceDir(cwd));
  const configPath = args.config
    ? path.resolve(args.config)
    : path.join(workspaceRoot, '.agentv', 'workspace.yaml');

  if (args.force) {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  } else if (await isNonEmptyDir(workspaceRoot)) {
    throw new Error(
      `Workspace directory already exists and is not empty: ${workspaceRoot} (use --force to overwrite)`,
    );
  }

  await fs.mkdir(workspaceRoot, { recursive: true });
  await writeDefaultWorkspaceConfig(configPath, workspaceRoot);

  return { workspaceRoot, configPath };
}
