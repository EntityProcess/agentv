import { type ChildProcess, exec, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { pathExists, removeIfExists } from '../utils/fs.js';
import { pathToFileUri } from '../utils/path.js';
import { sleep } from '../utils/time.js';
import { DEFAULT_ALIVE_FILENAME } from './constants.js';

const execAsync = promisify(exec);

/** Quote a command path for shell usage if it contains spaces. */
function shellQuote(cmd: string): string {
  return cmd.includes(' ') ? `"${cmd}"` : cmd;
}

const DEFAULT_WAKEUP_CONTENT = `---
description: 'Wake-up Signal'
model: Grok Code Fast 1 (copilot)
---`;

/**
 * Spawn VS Code with an `error` event listener so ENOENT / EACCES don't go unhandled.
 * Returns the ChildProcess for further use.
 */
function spawnVsCode(
  vscodeCmd: string,
  args: string[],
  options?: { shell?: boolean },
): ChildProcess {
  const child = spawn(vscodeCmd, args, {
    windowsHide: true,
    shell: options?.shell ?? true,
    detached: false,
  });
  child.on('error', () => {
    // Handled by raceSpawnError when used, or silently ignored for fire-and-forget calls
  });
  return child;
}

/**
 * Wait briefly after spawning to detect immediate failures (ENOENT, EACCES).
 * Rejects if the process emits an `error` event within the grace period.
 */
async function raceSpawnError(child: ChildProcess, graceMs = 200): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const onError = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    child.on('error', onError);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.removeListener('error', onError);
        resolve();
      }
    }, graceMs);
  });
}

export async function checkWorkspaceOpened(
  workspaceName: string,
  vscodeCmd: string,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`${shellQuote(vscodeCmd)} --status`, {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.includes(workspaceName);
  } catch {
    return false;
  }
}

export async function ensureWorkspaceFocused(
  workspacePath: string,
  workspaceName: string,
  subagentDir: string,
  vscodeCmd: string,
  pollInterval = 1,
  timeout = 60,
): Promise<boolean> {
  const alreadyOpen = await checkWorkspaceOpened(workspaceName, vscodeCmd);

  if (alreadyOpen) {
    spawnVsCode(shellQuote(vscodeCmd), [workspacePath]);
    return true;
  }

  const aliveFile = path.join(subagentDir, DEFAULT_ALIVE_FILENAME);
  await removeIfExists(aliveFile);

  const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
  await mkdir(githubAgentsDir, { recursive: true });
  const wakeupDst = path.join(githubAgentsDir, 'wakeup.md');
  await writeFile(wakeupDst, DEFAULT_WAKEUP_CONTENT, 'utf8');

  spawnVsCode(shellQuote(vscodeCmd), [workspacePath]);
  await sleep(100);

  const wakeupChatId = 'wakeup';
  const chatArgs = [
    '-r',
    'chat',
    '-m',
    wakeupChatId,
    `create a file named .alive in the ${path.basename(subagentDir)} folder`,
  ];
  spawnVsCode(shellQuote(vscodeCmd), chatArgs);

  const start = Date.now();
  while (!(await pathExists(aliveFile))) {
    if (Date.now() - start > timeout * 1000) {
      console.error(`warning: Workspace readiness timeout after ${timeout}s`);
      return false;
    }
    await sleep(pollInterval * 1000);
  }

  return true;
}

export async function launchVsCodeWithChat(
  subagentDir: string,
  chatId: string,
  attachmentPaths: string[],
  requestInstructions: string,
  timestamp: string,
  vscodeCmd: string,
): Promise<void> {
  const workspacePath = path.join(subagentDir, `${path.basename(subagentDir)}.code-workspace`);
  const messagesDir = path.join(subagentDir, 'messages');
  await mkdir(messagesDir, { recursive: true });

  const reqFile = path.join(messagesDir, `${timestamp}_req.md`);
  await writeFile(reqFile, requestInstructions, { encoding: 'utf8' });

  const reqUri = pathToFileUri(reqFile);
  const chatArgs = ['-r', 'chat', '-m', chatId];
  for (const attachment of attachmentPaths) {
    chatArgs.push('-a', attachment);
  }
  chatArgs.push('-a', reqFile);
  chatArgs.push(`Follow instructions in [${path.basename(reqFile)}](${reqUri})`);

  const workspaceReady = await ensureWorkspaceFocused(
    workspacePath,
    path.basename(subagentDir),
    subagentDir,
    vscodeCmd,
  );
  if (!workspaceReady) {
    throw new Error(
      `VS Code workspace '${path.basename(subagentDir)}' failed to become ready within the timeout. Check that '${vscodeCmd}' can open workspaces.`,
    );
  }

  await sleep(500);
  const child = spawnVsCode(shellQuote(vscodeCmd), chatArgs);
  await raceSpawnError(child);
}

export async function launchVsCodeWithBatchChat(
  subagentDir: string,
  chatId: string,
  attachmentPaths: string[],
  chatInstruction: string,
  vscodeCmd: string,
): Promise<void> {
  const workspacePath = path.join(subagentDir, `${path.basename(subagentDir)}.code-workspace`);
  const messagesDir = path.join(subagentDir, 'messages');
  await mkdir(messagesDir, { recursive: true });

  const chatArgs = ['-r', 'chat', '-m', chatId];
  for (const attachment of attachmentPaths) {
    chatArgs.push('-a', attachment);
  }
  chatArgs.push(chatInstruction);

  const workspaceReady = await ensureWorkspaceFocused(
    workspacePath,
    path.basename(subagentDir),
    subagentDir,
    vscodeCmd,
  );
  if (!workspaceReady) {
    throw new Error(
      `VS Code workspace '${path.basename(subagentDir)}' failed to become ready within the timeout. Check that '${vscodeCmd}' can open workspaces.`,
    );
  }

  await sleep(500);
  const child = spawnVsCode(shellQuote(vscodeCmd), chatArgs);
  await raceSpawnError(child);
}
