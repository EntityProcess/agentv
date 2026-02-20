import path from 'node:path';

import type { EvaluationResult } from '@agentv/core';

import { JsonWriter } from './json-writer.js';
import { JsonlWriter } from './jsonl-writer.js';
import { JunitWriter } from './junit-writer.js';
import { YamlWriter } from './yaml-writer.js';

export type OutputFormat = 'jsonl' | 'yaml';

export interface OutputWriter {
  append(result: EvaluationResult): Promise<void>;
  close(): Promise<void>;
}

export async function createOutputWriter(
  filePath: string,
  format: OutputFormat,
): Promise<OutputWriter> {
  switch (format) {
    case 'jsonl':
      return JsonlWriter.open(filePath);
    case 'yaml':
      return YamlWriter.open(filePath);
    default: {
      const exhaustiveCheck: never = format;
      throw new Error(`Unsupported output format: ${exhaustiveCheck}`);
    }
  }
}

export function getDefaultExtension(format: OutputFormat): string {
  switch (format) {
    case 'jsonl':
      return '.jsonl';
    case 'yaml':
      return '.yaml';
    default: {
      const exhaustiveCheck: never = format;
      throw new Error(`Unsupported output format: ${exhaustiveCheck}`);
    }
  }
}

const SUPPORTED_EXTENSIONS = new Set(['.jsonl', '.json', '.xml', '.yaml', '.yml']);

export function createWriterFromPath(filePath: string): Promise<OutputWriter> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jsonl':
      return JsonlWriter.open(filePath);
    case '.json':
      return JsonWriter.open(filePath);
    case '.xml':
      return JunitWriter.open(filePath);
    case '.yaml':
    case '.yml':
      return YamlWriter.open(filePath);
    default:
      throw new Error(
        `Unsupported output file extension "${ext}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
      );
  }
}

export async function createMultiWriter(filePaths: readonly string[]): Promise<OutputWriter> {
  const writers = await Promise.all(filePaths.map((fp) => createWriterFromPath(fp)));
  return {
    async append(result: EvaluationResult): Promise<void> {
      await Promise.all(writers.map((w) => w.append(result)));
    },
    async close(): Promise<void> {
      await Promise.all(writers.map((w) => w.close()));
    },
  };
}
