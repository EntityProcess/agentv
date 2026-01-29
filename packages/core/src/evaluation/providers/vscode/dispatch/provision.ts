import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureDir, pathExists, readDirEntries, removeIfExists } from '../utils/fs.js';
import { DEFAULT_LOCK_NAME } from './constants.js';

const DEFAULT_WORKSPACE_TEMPLATE = {
  folders: [
    {
      path: '.',
    },
  ],
  settings: {
    'chat.modeFilesLocations': {
      '.github/agents/**/*.md': true,
    },
  },
};

const DEFAULT_WAKEUP_CONTENT = `---
description: 'Wake-up Signal'
tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo']
model: GPT-4.1 (copilot)
---`;

export interface ProvisionOptions {
  targetRoot: string;
  subagents: number;
  lockName?: string;
  force?: boolean;
  dryRun?: boolean;
  workspaceTemplate?: Record<string, unknown>;
  wakeupContent?: string;
}

export interface ProvisionResult {
  created: string[];
  skippedExisting: string[];
  skippedLocked: string[];
}

export async function provisionSubagents(options: ProvisionOptions): Promise<ProvisionResult> {
  const {
    targetRoot,
    subagents,
    lockName = DEFAULT_LOCK_NAME,
    force = false,
    dryRun = false,
    workspaceTemplate = DEFAULT_WORKSPACE_TEMPLATE,
    wakeupContent = DEFAULT_WAKEUP_CONTENT,
  } = options;

  if (!Number.isInteger(subagents) || subagents < 1) {
    throw new Error('subagents must be a positive integer');
  }

  const targetPath = path.resolve(targetRoot);

  if (!dryRun) {
    await ensureDir(targetPath);
  }

  let highestNumber = 0;
  const lockedSubagents = new Set<string>();
  const existingSubagents: Array<{ number: number; absolutePath: string }> = [];

  if (await pathExists(targetPath)) {
    const entries = await readDirEntries(targetPath);
    for (const entry of entries) {
      if (!entry.isDirectory || !entry.name.startsWith('subagent-')) {
        continue;
      }

      const suffix = entry.name.split('-')[1];
      if (!suffix) continue;
      const parsed = Number.parseInt(suffix, 10);
      if (!Number.isInteger(parsed)) {
        continue;
      }

      highestNumber = Math.max(highestNumber, parsed);
      const lockFile = path.join(entry.absolutePath, lockName);
      const locked = await pathExists(lockFile);
      if (locked) {
        lockedSubagents.add(entry.absolutePath);
      }

      existingSubagents.push({ number: parsed, absolutePath: entry.absolutePath });
    }

    existingSubagents.sort((a, b) => a.number - b.number);
  }

  const created: string[] = [];
  const skippedExisting: string[] = [];

  let subagentsProvisioned = 0;

  for (const subagent of existingSubagents) {
    if (subagentsProvisioned >= subagents) {
      break;
    }

    const subagentDir = subagent.absolutePath;
    const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
    const lockFile = path.join(subagentDir, lockName);
    const workspaceDst = path.join(subagentDir, `${path.basename(subagentDir)}.code-workspace`);
    const wakeupDst = path.join(githubAgentsDir, 'wakeup.md');

    const isLocked = await pathExists(lockFile);
    if (isLocked && !force) {
      continue;
    }

    if (isLocked && force) {
      if (!dryRun) {
        await removeIfExists(lockFile);
        await ensureDir(githubAgentsDir);
        await writeFile(workspaceDst, JSON.stringify(workspaceTemplate, null, 2), 'utf8');
        await writeFile(wakeupDst, wakeupContent, 'utf8');
      }
      created.push(subagentDir);
      lockedSubagents.delete(subagentDir);
      subagentsProvisioned += 1;
      continue;
    }

    if (!isLocked && force) {
      if (!dryRun) {
        await ensureDir(githubAgentsDir);
        await writeFile(workspaceDst, JSON.stringify(workspaceTemplate, null, 2), 'utf8');
        await writeFile(wakeupDst, wakeupContent, 'utf8');
      }
      created.push(subagentDir);
      subagentsProvisioned += 1;
      continue;
    }

    if (!dryRun && !(await pathExists(workspaceDst))) {
      await ensureDir(githubAgentsDir);
      await writeFile(workspaceDst, JSON.stringify(workspaceTemplate, null, 2), 'utf8');
      await writeFile(wakeupDst, wakeupContent, 'utf8');
    }

    skippedExisting.push(subagentDir);
    subagentsProvisioned += 1;
  }

  let nextIndex = highestNumber;
  while (subagentsProvisioned < subagents) {
    nextIndex += 1;
    const subagentDir = path.join(targetPath, `subagent-${nextIndex}`);
    const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
    const workspaceDst = path.join(subagentDir, `${path.basename(subagentDir)}.code-workspace`);
    const wakeupDst = path.join(githubAgentsDir, 'wakeup.md');

    if (!dryRun) {
      await ensureDir(subagentDir);
      await ensureDir(githubAgentsDir);
      await writeFile(workspaceDst, JSON.stringify(workspaceTemplate, null, 2), 'utf8');
      await writeFile(wakeupDst, wakeupContent, 'utf8');
    }

    created.push(subagentDir);
    subagentsProvisioned += 1;
  }

  return {
    created,
    skippedExisting,
    skippedLocked: Array.from(lockedSubagents).sort(),
  };
}
