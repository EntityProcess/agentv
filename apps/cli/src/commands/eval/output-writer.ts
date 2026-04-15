import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

import { HtmlWriter } from './html-writer.js';
import { JsonWriter } from './json-writer.js';
import { JsonlWriter } from './jsonl-writer.js';
import { JunitWriter } from './junit-writer.js';
import { YamlWriter } from './yaml-writer.js';

export type OutputFormat = 'jsonl' | 'yaml' | 'html';

export interface OutputWriter {
  append(result: EvaluationResult): Promise<void>;
  close(): Promise<void>;
}

export interface WriterOptions {
  readonly threshold?: number;
}

export async function createOutputWriter(
  filePath: string,
  format: OutputFormat,
  options?: { append?: boolean },
): Promise<OutputWriter> {
  switch (format) {
    case 'jsonl':
      return JsonlWriter.open(filePath, { append: options?.append });
    case 'yaml':
      return YamlWriter.open(filePath);
    case 'html':
      return HtmlWriter.open(filePath);
    default: {
      const exhaustiveCheck: never = format;
      throw new Error(`Unsupported output format: ${exhaustiveCheck}`);
    }
  }
}

const SUPPORTED_EXTENSIONS = new Set(['.jsonl', '.json', '.xml', '.yaml', '.yml', '.html', '.htm']);

export function createWriterFromPath(
  filePath: string,
  options?: WriterOptions,
): Promise<OutputWriter> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jsonl':
      return JsonlWriter.open(filePath);
    case '.json':
      return JsonWriter.open(filePath);
    case '.xml':
      return JunitWriter.open(filePath, { threshold: options?.threshold });
    case '.yaml':
    case '.yml':
      return YamlWriter.open(filePath);
    case '.html':
    case '.htm':
      return HtmlWriter.open(filePath);
    default:
      throw new Error(
        `Unsupported output file extension "${ext}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
      );
  }
}

export async function createMultiWriter(
  filePaths: readonly string[],
  options?: WriterOptions,
): Promise<OutputWriter> {
  const writers = await Promise.all(filePaths.map((fp) => createWriterFromPath(fp, options)));
  return {
    async append(result: EvaluationResult): Promise<void> {
      await Promise.all(writers.map((w) => w.append(result)));
    },
    async close(): Promise<void> {
      await Promise.all(writers.map((w) => w.close()));
    },
  };
}
