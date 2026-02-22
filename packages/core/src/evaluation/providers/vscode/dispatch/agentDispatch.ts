import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pathExists } from '../utils/fs.js';
import { pathToFileUri } from '../utils/path.js';
import {
  createBatchOrchestratorPrompt,
  createBatchRequestPrompt,
  createRequestPrompt,
  loadDefaultBatchOrchestratorTemplate,
  loadDefaultBatchRequestTemplate,
  loadDefaultRequestTemplate,
} from './promptBuilder.js';
import { waitForBatchResponses, waitForResponseOutput } from './responseWaiter.js';
import { launchVsCodeWithBatchChat, launchVsCodeWithChat } from './vscodeProcess.js';
import {
  findUnlockedSubagent,
  getSubagentRoot,
  prepareSubagentDirectory,
  removeSubagentLock,
} from './workspaceManager.js';

function generateTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

async function resolvePromptFile(promptFile: string | undefined): Promise<string | undefined> {
  if (!promptFile) {
    return undefined;
  }

  const resolvedPrompt = path.resolve(promptFile);
  if (!(await pathExists(resolvedPrompt))) {
    throw new Error(`Prompt file not found: ${resolvedPrompt}`);
  }

  const promptStats = await stat(resolvedPrompt);
  if (!promptStats.isFile()) {
    throw new Error(`Prompt file must be a file, not a directory: ${resolvedPrompt}`);
  }

  return resolvedPrompt;
}

async function resolveAttachments(
  extraAttachments: readonly string[] | undefined,
): Promise<string[]> {
  if (!extraAttachments) {
    return [];
  }

  const resolved: string[] = [];
  for (const attachment of extraAttachments) {
    const resolvedPath = path.resolve(attachment);
    if (!(await pathExists(resolvedPath))) {
      throw new Error(`Attachment not found: ${resolvedPath}`);
    }
    resolved.push(resolvedPath);
  }
  return resolved;
}

export interface DispatchOptions {
  userQuery: string;
  promptFile?: string;
  requestTemplate?: string;
  extraAttachments?: readonly string[];
  workspaceTemplate?: string;
  cwd?: string;
  dryRun?: boolean;
  wait?: boolean;
  vscodeCmd?: string;
  subagentRoot?: string;
  silent?: boolean;
  timeoutMs?: number;
}

export interface BatchDispatchOptions extends Omit<DispatchOptions, 'userQuery'> {
  userQueries: string[];
}

export interface BatchDispatchResult {
  readonly exitCode: number;
  readonly subagentName?: string;
  readonly requestFiles: string[];
  readonly responseFiles?: string[];
  readonly queryCount: number;
  readonly error?: string;
}

export interface DispatchSessionResult {
  readonly exitCode: number;
  readonly subagentName?: string;
  readonly responseFile?: string;
  readonly tempFile?: string;
  readonly error?: string;
}

export async function dispatchAgentSession(
  options: DispatchOptions,
): Promise<DispatchSessionResult> {
  const {
    userQuery,
    promptFile,
    requestTemplate,
    extraAttachments,
    workspaceTemplate,
    cwd,
    dryRun = false,
    wait = true,
    vscodeCmd = 'code',
    subagentRoot,
    silent = false,
    timeoutMs,
  } = options;

  try {
    let resolvedPrompt: string | undefined;
    try {
      resolvedPrompt = await resolvePromptFile(promptFile);
    } catch (error) {
      return {
        exitCode: 1,
        error: (error as Error).message,
      };
    }

    const templateContent = requestTemplate ?? loadDefaultRequestTemplate();

    const subagentRootPath = subagentRoot ?? getSubagentRoot(vscodeCmd);
    const subagentDir = await findUnlockedSubagent(subagentRootPath);
    if (!subagentDir) {
      return {
        exitCode: 1,
        error:
          'No unlocked subagents available. Provision additional subagents with: subagent code provision --subagents <desired_total>',
      };
    }

    const subagentName = path.basename(subagentDir);
    const chatId = Math.random().toString(16).slice(2, 10);
    const preparationResult = await prepareSubagentDirectory(
      subagentDir,
      resolvedPrompt,
      chatId,
      workspaceTemplate,
      dryRun,
      cwd,
    );
    if (preparationResult !== 0) {
      return {
        exitCode: preparationResult,
        subagentName,
        error: 'Failed to prepare subagent workspace',
      };
    }

    let attachments: string[];
    try {
      attachments = await resolveAttachments(extraAttachments);
    } catch (attachmentError) {
      return {
        exitCode: 1,
        subagentName,
        error: (attachmentError as Error).message,
      };
    }

    const timestamp = generateTimestamp();
    const messagesDir = path.join(subagentDir, 'messages');
    const responseFileTmp = path.join(messagesDir, `${timestamp}_res.tmp.md`);
    const responseFileFinal = path.join(messagesDir, `${timestamp}_res.md`);

    const requestInstructions = createRequestPrompt(
      userQuery,
      responseFileTmp,
      responseFileFinal,
      templateContent,
    );

    if (dryRun) {
      return {
        exitCode: 0,
        subagentName,
        responseFile: responseFileFinal,
        tempFile: responseFileTmp,
      };
    }

    await launchVsCodeWithChat(
      subagentDir,
      chatId,
      attachments,
      requestInstructions,
      timestamp,
      vscodeCmd,
    );

    if (!wait) {
      return {
        exitCode: 0,
        subagentName,
        responseFile: responseFileFinal,
        tempFile: responseFileTmp,
      };
    }

    const received = await waitForResponseOutput(responseFileFinal, 1000, silent, timeoutMs);
    if (!received) {
      return {
        exitCode: 1,
        subagentName,
        responseFile: responseFileFinal,
        tempFile: responseFileTmp,
        error: 'Timed out waiting for agent response',
      };
    }

    await removeSubagentLock(subagentDir);

    return {
      exitCode: 0,
      subagentName,
      responseFile: responseFileFinal,
      tempFile: responseFileTmp,
    };
  } catch (error) {
    return {
      exitCode: 1,
      error: (error as Error).message,
    };
  }
}

export async function dispatchBatchAgent(
  options: BatchDispatchOptions,
): Promise<BatchDispatchResult> {
  const {
    userQueries,
    promptFile,
    requestTemplate,
    extraAttachments,
    workspaceTemplate,
    dryRun = false,
    wait = false,
    vscodeCmd = 'code',
    subagentRoot,
    silent = false,
    timeoutMs,
  } = options;

  if (!userQueries || userQueries.length === 0) {
    return {
      exitCode: 1,
      requestFiles: [],
      queryCount: 0,
      error: 'At least one query is required for batch dispatch',
    };
  }

  const queryCount = userQueries.length;
  let requestFiles: string[] = [];
  let responseFilesFinal: string[] = [];
  let subagentName: string | undefined;

  try {
    let resolvedPrompt: string | undefined;
    try {
      resolvedPrompt = await resolvePromptFile(promptFile);
    } catch (error) {
      return {
        exitCode: 1,
        requestFiles,
        queryCount,
        error: (error as Error).message,
      };
    }

    const batchRequestTemplateContent = requestTemplate ?? loadDefaultBatchRequestTemplate();

    const orchestratorTemplateContent = loadDefaultBatchOrchestratorTemplate();

    const subagentRootPath = subagentRoot ?? getSubagentRoot(vscodeCmd);
    const subagentDir = await findUnlockedSubagent(subagentRootPath);
    if (!subagentDir) {
      return {
        exitCode: 1,
        requestFiles,
        queryCount,
        error:
          'No unlocked subagents available. Provision additional subagents with: subagent code provision --subagents <desired_total>',
      };
    }

    subagentName = path.basename(subagentDir);
    const chatId = Math.random().toString(16).slice(2, 10);
    const preparationResult = await prepareSubagentDirectory(
      subagentDir,
      resolvedPrompt,
      chatId,
      workspaceTemplate,
      dryRun,
    );
    if (preparationResult !== 0) {
      return {
        exitCode: preparationResult,
        subagentName,
        requestFiles,
        queryCount,
        error: 'Failed to prepare subagent workspace',
      };
    }

    let attachments: string[];
    try {
      attachments = await resolveAttachments(extraAttachments);
    } catch (attachmentError) {
      return {
        exitCode: 1,
        subagentName,
        requestFiles,
        queryCount,
        error: (attachmentError as Error).message,
      };
    }

    const timestamp = generateTimestamp();
    const messagesDir = path.join(subagentDir, 'messages');

    requestFiles = userQueries.map((_, index) =>
      path.join(messagesDir, `${timestamp}_${index}_req.md`),
    );
    const responseTmpFiles = userQueries.map((_, index) =>
      path.join(messagesDir, `${timestamp}_${index}_res.tmp.md`),
    );
    responseFilesFinal = userQueries.map((_, index) =>
      path.join(messagesDir, `${timestamp}_${index}_res.md`),
    );
    const orchestratorFile = path.join(messagesDir, `${timestamp}_orchestrator.md`);

    if (!dryRun) {
      await Promise.all(
        userQueries.map((query, index) => {
          const reqFile = requestFiles[index] as string;
          const tmpFile = responseTmpFiles[index] as string;
          const finalFile = responseFilesFinal[index] as string;
          return writeFile(
            reqFile,
            createBatchRequestPrompt(query, tmpFile, finalFile, batchRequestTemplateContent),
            { encoding: 'utf8' },
          );
        }),
      );

      const orchestratorContent = createBatchOrchestratorPrompt(
        requestFiles,
        responseFilesFinal,
        orchestratorTemplateContent,
      );
      await writeFile(orchestratorFile, orchestratorContent, { encoding: 'utf8' });
    }

    const chatAttachments = [orchestratorFile, ...attachments];
    const orchestratorUri = pathToFileUri(orchestratorFile);
    const chatInstruction = `Follow instructions in [${timestamp}_orchestrator.md](${orchestratorUri}). Use #runSubagent tool.`;

    if (dryRun) {
      return {
        exitCode: 0,
        subagentName,
        requestFiles,
        responseFiles: wait ? responseFilesFinal : undefined,
        queryCount,
      };
    }

    await launchVsCodeWithBatchChat(
      subagentDir,
      chatId,
      chatAttachments,
      chatInstruction,
      vscodeCmd,
    );

    if (!wait) {
      return {
        exitCode: 0,
        subagentName,
        requestFiles,
        queryCount,
      };
    }

    const responsesCompleted = await waitForBatchResponses(
      responseFilesFinal,
      1000,
      silent,
      timeoutMs,
    );
    if (!responsesCompleted) {
      return {
        exitCode: 1,
        subagentName,
        requestFiles,
        responseFiles: responseFilesFinal,
        queryCount,
        error: 'Timed out waiting for batch responses',
      };
    }

    await removeSubagentLock(subagentDir);

    return {
      exitCode: 0,
      subagentName,
      requestFiles,
      responseFiles: responseFilesFinal,
      queryCount,
    };
  } catch (error) {
    return {
      exitCode: 1,
      subagentName,
      requestFiles,
      responseFiles: responseFilesFinal.length > 0 ? responseFilesFinal : undefined,
      queryCount,
      error: (error as Error).message,
    };
  }
}

export { getSubagentRoot } from './workspaceManager.js';
