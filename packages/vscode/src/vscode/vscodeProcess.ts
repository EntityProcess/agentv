import { exec, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { pathExists, removeIfExists } from '../utils/fs.js';
import { pathToFileUri } from '../utils/path.js';
import { sleep } from '../utils/time.js';
import { DEFAULT_ALIVE_FILENAME } from './constants.js';

const execAsync = promisify(exec);

/**
 * Default wakeup agent content
 */
const DEFAULT_WAKEUP_CONTENT = `---
description: 'Wake-up Signal'
model: Grok Code Fast 1 (copilot)
---`;

/**
 * Check if a workspace is currently opened in VS Code
 */
export async function checkWorkspaceOpened(
  workspaceName: string,
  vscodeCmd: string,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`${vscodeCmd} --status`, {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout.includes(workspaceName);
  } catch {
    return false;
  }
}

/**
 * Ensure a workspace is focused and ready for agent dispatch
 */
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
    spawn(vscodeCmd, [workspacePath], { windowsHide: true, shell: true, detached: false });
    return true;
  }

  const aliveFile = path.join(subagentDir, DEFAULT_ALIVE_FILENAME);
  await removeIfExists(aliveFile);

  const githubAgentsDir = path.join(subagentDir, '.github', 'agents');
  await mkdir(githubAgentsDir, { recursive: true });
  const wakeupDst = path.join(githubAgentsDir, 'wakeup.md');
  await writeFile(wakeupDst, DEFAULT_WAKEUP_CONTENT, 'utf8');

  spawn(vscodeCmd, [workspacePath], { windowsHide: true, shell: true, detached: false });
  await sleep(100);

  const wakeupChatId = 'wakeup';
  const chatArgs = [
    '-r',
    'chat',
    '-m',
    wakeupChatId,
    `create a file named .alive in the ${path.basename(subagentDir)} folder`,
  ];
  spawn(vscodeCmd, chatArgs, { windowsHide: true, shell: true, detached: false });

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

/**
 * Launch VS Code with a chat request for single agent dispatch
 */
export async function launchVsCodeWithChat(
  subagentDir: string,
  chatId: string,
  attachmentPaths: string[],
  requestInstructions: string,
  timestamp: string,
  vscodeCmd: string,
): Promise<boolean> {
  try {
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
      console.error('warning: Workspace may not be fully ready');
    }

    await sleep(500);
    spawn(vscodeCmd, chatArgs, { windowsHide: true, shell: true, detached: false });
    return true;
  } catch (error) {
    console.error(`warning: Failed to launch VS Code: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Launch VS Code with a batch chat request for batch agent dispatch
 */
export async function launchVsCodeWithBatchChat(
  subagentDir: string,
  chatId: string,
  attachmentPaths: string[],
  chatInstruction: string,
  vscodeCmd: string,
): Promise<boolean> {
  try {
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
      console.error('warning: Workspace may not be fully ready');
    }

    await sleep(500);
    spawn(vscodeCmd, chatArgs, { windowsHide: true, shell: true, detached: false });
    return true;
  } catch (error) {
    console.error(`warning: Failed to launch VS Code: ${(error as Error).message}`);
    return false;
  }
}
