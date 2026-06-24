import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { JsonValue } from '../types.js';
import { fileExists, resolveFileReference } from './file-resolver.js';

export const PROMPT_MD_FILENAME = 'PROMPT.md';

export type PromptMdInputFilesSource = 'test' | 'suite';

export type PromptMdFallbackResult = {
  readonly promptText: string;
  readonly promptPath: string;
  readonly source: 'input_files' | 'sibling';
  readonly inputFilesSource?: PromptMdInputFilesSource;
  readonly remainingInputFiles?: readonly string[];
};

type PromptMdFallbackOptions = {
  readonly evalFilePath: string;
  readonly searchRoots: readonly string[];
  readonly testInputFiles?: JsonValue;
  readonly suiteInputFiles?: JsonValue;
};

type InputFilesSplit = {
  readonly files?: readonly string[];
  readonly promptFile?: string;
  readonly remainingInputFiles?: readonly string[];
};

function asStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function basenameForPortablePath(value: string): string {
  return value.split(/[\\/]/).at(-1) ?? value;
}

function isPromptMdPath(value: string): boolean {
  return basenameForPortablePath(value) === PROMPT_MD_FILENAME;
}

function splitInputFiles(value: JsonValue | undefined): InputFilesSplit {
  const files = asStringArray(value);
  if (!files) {
    return {};
  }
  const promptFile = files.find(isPromptMdPath);
  const remaining = promptFile ? files.filter((file) => !isPromptMdPath(file)) : files;
  return {
    files,
    ...(promptFile ? { promptFile } : {}),
    ...(remaining.length > 0 ? { remainingInputFiles: remaining } : {}),
  };
}

async function readPromptFile(promptPath: string): Promise<string> {
  return (await readFile(promptPath, 'utf8')).replace(/\r\n/g, '\n');
}

/**
 * Resolve Vercel-style task prompt fallback for evals that omit `input`.
 *
 * `input_files` keeps its existing attachment meaning. Only a file named exactly
 * `PROMPT.md` is promoted to task prompt text, and only when `input` is absent.
 * If no explicit PROMPT.md is listed, the loader falls back to a sibling
 * `PROMPT.md` beside the EVAL.yaml file.
 */
export async function loadPromptMdFallback(
  options: PromptMdFallbackOptions,
): Promise<PromptMdFallbackResult | undefined> {
  const testSplit = splitInputFiles(options.testInputFiles);
  const suiteSplit = splitInputFiles(options.suiteInputFiles);
  const inputFilesSource: PromptMdInputFilesSource | undefined = testSplit.files
    ? 'test'
    : suiteSplit.files
      ? 'suite'
      : undefined;
  const activeSplit = inputFilesSource === 'test' ? testSplit : suiteSplit;

  if (activeSplit.promptFile) {
    const resolved = await resolveFileReference(activeSplit.promptFile, options.searchRoots);
    if (resolved.resolvedPath) {
      return {
        promptText: await readPromptFile(resolved.resolvedPath),
        promptPath: path.resolve(resolved.resolvedPath),
        source: 'input_files',
        ...(inputFilesSource ? { inputFilesSource } : {}),
        ...(activeSplit.remainingInputFiles
          ? { remainingInputFiles: activeSplit.remainingInputFiles }
          : {}),
      };
    }
  }

  const siblingPromptPath = path.join(
    path.dirname(path.resolve(options.evalFilePath)),
    PROMPT_MD_FILENAME,
  );
  if (await fileExists(siblingPromptPath)) {
    return {
      promptText: await readPromptFile(siblingPromptPath),
      promptPath: siblingPromptPath,
      source: 'sibling',
    };
  }

  return undefined;
}
