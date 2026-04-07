import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execFileWithStdin } from '../runtime/exec.js';
import type { Content, ContentFile } from './content.js';
import type { ContentPreprocessorConfig } from './types.js';

const MIME_TYPE_ALIASES: Record<string, string> = {
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  htm: 'text/html',
  html: 'text/html',
  json: 'application/json',
  markdown: 'text/markdown',
  md: 'text/markdown',
  pdf: 'application/pdf',
  sql: 'application/sql',
  txt: 'text/plain',
  xhtml: 'application/xhtml+xml',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

const REPLACEMENT_CHAR = '\ufffd';

export interface FilePreprocessingWarning {
  readonly file: string;
  readonly mediaType: string;
  readonly reason: string;
}

export interface ExtractedContentText {
  readonly text: string;
  readonly warnings: readonly FilePreprocessingWarning[];
}

export async function extractTextWithPreprocessors(
  content: string | readonly Content[] | undefined,
  preprocessors: readonly ContentPreprocessorConfig[] | undefined,
): Promise<ExtractedContentText> {
  if (typeof content === 'string') {
    return { text: content, warnings: [] };
  }
  if (!content || content.length === 0) {
    return { text: '', warnings: [] };
  }

  const parts: string[] = [];
  const warnings: FilePreprocessingWarning[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
      continue;
    }
    if (block.type !== 'file') {
      continue;
    }

    const result = await preprocessContentFile(block, preprocessors);
    if (result.text) {
      parts.push(result.text);
    }
    warnings.push(...result.warnings);
  }

  return { text: parts.join('\n'), warnings };
}

async function preprocessContentFile(
  block: ContentFile,
  preprocessors: readonly ContentPreprocessorConfig[] | undefined,
): Promise<ExtractedContentText> {
  const mediaType = normalizePreprocessorType(block.media_type);
  const resolvedPath = resolveLocalFilePath(block.path);

  if (!resolvedPath) {
    return {
      text: '',
      warnings: [
        {
          file: block.path,
          mediaType: block.media_type,
          reason: 'remote file paths are not supported for preprocessing',
        },
      ],
    };
  }

  const preprocessor = preprocessors?.find(
    (entry) => normalizePreprocessorType(entry.type) === mediaType,
  );
  if (preprocessor) {
    return runContentPreprocessor(block, resolvedPath, preprocessor);
  }

  try {
    const buffer = await readFile(resolvedPath);
    const text = buffer.toString('utf8').replace(/\r\n/g, '\n');
    if (buffer.includes(0) || text.includes(REPLACEMENT_CHAR)) {
      return {
        text: '',
        warnings: [
          {
            file: block.path,
            mediaType: block.media_type,
            reason: 'default UTF-8 read produced binary or invalid text; configure a preprocessor',
          },
        ],
      };
    }
    return { text: formatFileText(block.path, text), warnings: [] };
  } catch (error) {
    return {
      text: '',
      warnings: [
        {
          file: block.path,
          mediaType: block.media_type,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function runContentPreprocessor(
  block: ContentFile,
  resolvedPath: string,
  preprocessor: ContentPreprocessorConfig,
): Promise<ExtractedContentText> {
  try {
    const argv = preprocessor.resolvedCommand ?? preprocessor.command;
    const { stdout, stderr, exitCode } = await execFileWithStdin(
      argv,
      JSON.stringify({
        path: resolvedPath,
        original_path: block.path,
        media_type: block.media_type,
      }),
    );

    if (exitCode !== 0) {
      return {
        text: '',
        warnings: [
          {
            file: block.path,
            mediaType: block.media_type,
            reason: stderr.trim() || `preprocessor exited with code ${exitCode}`,
          },
        ],
      };
    }

    return { text: formatFileText(block.path, stdout.trim()), warnings: [] };
  } catch (error) {
    return {
      text: '',
      warnings: [
        {
          file: block.path,
          mediaType: block.media_type,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function appendPreprocessingWarnings(
  text: string,
  warnings: readonly FilePreprocessingWarning[],
): string {
  if (warnings.length === 0) {
    return text;
  }

  const notes = warnings.map(
    (warning) =>
      `[file preprocessing warning] ${warning.file} (${warning.mediaType}): ${warning.reason}`,
  );

  return [text, ...notes].filter((part) => part.length > 0).join('\n');
}

export function normalizePreprocessorType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return MIME_TYPE_ALIASES[normalized] ?? normalized;
}

function resolveLocalFilePath(value: string): string | undefined {
  if (value.startsWith('file://')) {
    return fileURLToPath(value);
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    return undefined;
  }
  return path.resolve(value);
}

function formatFileText(filePath: string, text: string): string {
  return `[[ file: ${filePath} ]]\n${text}`;
}
