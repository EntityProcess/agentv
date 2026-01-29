import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { renderTemplate } from '../utils/template.js';
import {
  DEFAULT_BATCH_ORCHESTRATOR_TEMPLATE,
  DEFAULT_BATCH_REQUEST_TEMPLATE,
  DEFAULT_REQUEST_TEMPLATE,
} from './templates.js';

/**
 * Load a template file from the filesystem
 */
export async function loadTemplateFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load template file '${filePath}': ${(error as Error).message}`);
  }
}

/**
 * Load the default request prompt template
 */
export function loadDefaultRequestTemplate(): string {
  return DEFAULT_REQUEST_TEMPLATE;
}

/**
 * Load the default batch request prompt template
 */
export function loadDefaultBatchRequestTemplate(): string {
  return DEFAULT_BATCH_REQUEST_TEMPLATE;
}

/**
 * Load the default batch orchestrator prompt template
 */
export function loadDefaultBatchOrchestratorTemplate(): string {
  return DEFAULT_BATCH_ORCHESTRATOR_TEMPLATE;
}

/**
 * Create a request prompt for single agent dispatch
 */
export function createRequestPrompt(
  userQuery: string,
  responseFileTmp: string,
  responseFileFinal: string,
  templateContent: string,
): string {
  return renderTemplate(templateContent, {
    userQuery,
    responseFileTmp,
    responseFileFinal,
  });
}

/**
 * Create a batch request prompt for batch agent dispatch
 */
export function createBatchRequestPrompt(
  userQuery: string,
  responseFileTmp: string,
  responseFileFinal: string,
  templateContent: string,
): string {
  return renderTemplate(templateContent, {
    userQuery,
    responseFileTmp,
    responseFileFinal,
  });
}

/**
 * Create a batch orchestrator prompt that coordinates multiple subagent requests
 */
export function createBatchOrchestratorPrompt(
  requestFiles: readonly string[],
  responseFiles: readonly string[],
  templateContent: string,
): string {
  const requestLines = requestFiles
    .map((file, index) => `${index + 1}. messages/${path.basename(file)}`)
    .join('\n');
  const responseList = responseFiles.map((file) => `"${path.basename(file)}"`).join(', ');

  return renderTemplate(templateContent, {
    requestFiles: requestLines,
    responseList,
  });
}
