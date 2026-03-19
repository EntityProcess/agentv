import path from 'node:path';

import type { ProviderRequest } from './types.js';

export function buildPromptDocument(
  request: ProviderRequest,
  inputFiles: readonly string[] | undefined,
): string {
  const parts: string[] = [];

  const inputFilesList = collectInputFiles(inputFiles);

  const prereadBlock = buildMandatoryPrereadBlock(inputFilesList);
  if (prereadBlock.length > 0) {
    parts.push('\n', prereadBlock);
  }

  parts.push('\n[[ ## user_query ## ]]\n', request.question.trim());

  return parts.join('\n').trim();
}

export function normalizeInputFiles(
  inputFiles: readonly string[] | undefined,
): string[] | undefined {
  if (!inputFiles || inputFiles.length === 0) {
    return undefined;
  }
  const deduped = new Map<string, string>();
  for (const inputFile of inputFiles) {
    const absolutePath = path.resolve(inputFile);
    if (!deduped.has(absolutePath)) {
      deduped.set(absolutePath, absolutePath);
    }
  }
  return Array.from(deduped.values());
}

function collectInputFiles(inputFiles: readonly string[] | undefined): string[] {
  if (!inputFiles || inputFiles.length === 0) {
    return [];
  }
  const unique = new Map<string, string>();
  for (const inputFile of inputFiles) {
    const absolutePath = path.resolve(inputFile);
    if (!unique.has(absolutePath)) {
      unique.set(absolutePath, absolutePath);
    }
  }
  return Array.from(unique.values());
}

function buildMandatoryPrereadBlock(inputFiles: readonly string[]): string {
  if (inputFiles.length === 0) {
    return '';
  }

  const buildList = (files: readonly string[]): string[] =>
    files.map((absolutePath) => {
      const fileName = path.basename(absolutePath);
      const fileUri = pathToFileUri(absolutePath);
      return `* [${fileName}](${fileUri})`;
    });

  const sections: string[] = [];

  if (inputFiles.length > 0) {
    sections.push(`Read all input files:\n${buildList(inputFiles).join('\n')}.`);
  }

  sections.push(
    'If any file is missing, fail with ERROR: missing-file <filename> and stop.',
    'Then apply system_instructions on the user query below.',
  );

  return sections.join('\n');
}

function pathToFileUri(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const normalizedPath = absolutePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalizedPath)) {
    return `file:///${normalizedPath}`;
  }
  return `file://${normalizedPath}`;
}
