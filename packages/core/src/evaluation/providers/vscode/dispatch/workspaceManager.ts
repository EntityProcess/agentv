import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pathExists, readDirEntries, removeIfExists } from '../utils/fs.js';
import { transformWorkspacePaths } from '../utils/workspace.js';
import { DEFAULT_LOCK_NAME, getDefaultSubagentRoot } from './constants.js';

const DEFAULT_WORKSPACE_TEMPLATE = {
  folders: [
    {
      path: '.',
    },
  ],
};

export function getSubagentRoot(vscodeCmd = 'code'): string {
  return getDefaultSubagentRoot(vscodeCmd);
}

export async function findUnlockedSubagent(subagentRoot: string): Promise<string | null> {
  if (!(await pathExists(subagentRoot))) {
    return null;
  }

  const entries = await readDirEntries(subagentRoot);
  const subagents = entries
    .filter((entry) => entry.isDirectory && entry.name.startsWith('subagent-'))
    .map((entry) => ({
      absolutePath: entry.absolutePath,
      number: Number.parseInt(entry.name.split('-')[1] ?? '', 10),
    }))
    .filter((entry) => Number.isInteger(entry.number))
    .sort((a, b) => a.number - b.number);

  for (const subagent of subagents) {
    const lockFile = path.join(subagent.absolutePath, DEFAULT_LOCK_NAME);
    if (!(await pathExists(lockFile))) {
      return subagent.absolutePath;
    }
  }

  return null;
}

export async function copyAgentConfig(
  subagentDir: string,
  workspaceTemplate?: string,
  cwd?: string,
): Promise<{ workspace: string; messagesDir: string }> {
  let workspaceContent: unknown;

  if (workspaceTemplate) {
    const workspaceSrc = path.resolve(workspaceTemplate);

    if (!(await pathExists(workspaceSrc))) {
      throw new Error(`workspace template not found: ${workspaceSrc}`);
    }

    const stats = await stat(workspaceSrc);
    if (!stats.isFile()) {
      throw new Error(`workspace template must be a file, not a directory: ${workspaceSrc}`);
    }

    const templateText = await readFile(workspaceSrc, 'utf8');
    workspaceContent = JSON.parse(templateText);
  } else {
    workspaceContent = DEFAULT_WORKSPACE_TEMPLATE;
  }

  const workspaceName = `${path.basename(subagentDir)}.code-workspace`;
  const workspaceDst = path.join(subagentDir, workspaceName);
  const templateDir = workspaceTemplate
    ? path.dirname(path.resolve(workspaceTemplate))
    : subagentDir;
  const workspaceJson = JSON.stringify(workspaceContent, null, 2);
  let transformedContent = transformWorkspacePaths(workspaceJson, templateDir);

  if (cwd) {
    const absCwd = path.resolve(cwd);
    const parsed = JSON.parse(transformedContent) as { folders: { path: string }[] };
    const alreadyPresent = parsed.folders.some((f) => f.path === absCwd);
    if (!alreadyPresent) {
      parsed.folders.push({ path: absCwd });
      transformedContent = JSON.stringify(parsed, null, 2);
    }
  }

  await writeFile(workspaceDst, transformedContent, 'utf8');

  const messagesDir = path.join(subagentDir, 'messages');
  await mkdir(messagesDir, { recursive: true });

  return { workspace: workspaceDst, messagesDir };
}

export async function createSubagentLock(subagentDir: string): Promise<string> {
  const messagesDir = path.join(subagentDir, 'messages');
  if (await pathExists(messagesDir)) {
    const files = await readdir(messagesDir);
    await Promise.all(
      files.map(async (file) => {
        const target = path.join(messagesDir, file);
        await removeIfExists(target);
      }),
    );
  }

  const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
  if (await pathExists(githubAgentsDir)) {
    const agentFiles = await readdir(githubAgentsDir);
    const preservedFiles = new Set(['wakeup.md', 'subagent.md']);
    await Promise.all(
      agentFiles
        .filter((file) => file.endsWith('.md') && !preservedFiles.has(file))
        .map((file) => removeIfExists(path.join(githubAgentsDir, file))),
    );
  }

  const lockFile = path.join(subagentDir, DEFAULT_LOCK_NAME);
  await writeFile(lockFile, '', { encoding: 'utf8' });
  return lockFile;
}

export async function removeSubagentLock(subagentDir: string): Promise<void> {
  const lockFile = path.join(subagentDir, DEFAULT_LOCK_NAME);
  await removeIfExists(lockFile);
}

export async function prepareSubagentDirectory(
  subagentDir: string,
  promptFile: string | undefined,
  chatId: string,
  workspaceTemplate: string | undefined,
  dryRun: boolean,
  cwd?: string,
): Promise<number> {
  if (dryRun) {
    return 0;
  }

  try {
    await copyAgentConfig(subagentDir, workspaceTemplate, cwd);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }

  try {
    await createSubagentLock(subagentDir);
  } catch (error) {
    console.error(`error: Failed to create subagent lock: ${(error as Error).message}`);
    return 1;
  }

  if (promptFile) {
    const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
    await mkdir(githubAgentsDir, { recursive: true });
    const agentFile = path.join(githubAgentsDir, `${chatId}.md`);
    try {
      await copyFile(promptFile, agentFile);
    } catch (error) {
      console.error(`error: Failed to copy prompt file to agent mode: ${(error as Error).message}`);
      return 1;
    }
  }

  return 0;
}
