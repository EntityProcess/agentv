import path from 'node:path';

import { renderTemplate } from '../utils/template.js';
import {
  DEFAULT_BATCH_ORCHESTRATOR_TEMPLATE,
  DEFAULT_BATCH_REQUEST_TEMPLATE,
  DEFAULT_REQUEST_TEMPLATE,
} from './templates.js';

export function loadDefaultRequestTemplate(): string {
  return DEFAULT_REQUEST_TEMPLATE;
}

export function loadDefaultBatchRequestTemplate(): string {
  return DEFAULT_BATCH_REQUEST_TEMPLATE;
}

export function loadDefaultBatchOrchestratorTemplate(): string {
  return DEFAULT_BATCH_ORCHESTRATOR_TEMPLATE;
}

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
