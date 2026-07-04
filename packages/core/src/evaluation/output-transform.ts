import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Content } from './content.js';
import type { JsonObject } from './types.js';

export type TransformSpec = string;
type TransformFunction = (output: unknown, context: TransformContext) => unknown | Promise<unknown>;

export interface TransformPromptContext {
  readonly id?: string;
  readonly label?: string;
  readonly raw?: string;
}

export interface TransformContext {
  readonly vars?: JsonObject;
  readonly prompt?: TransformPromptContext;
  readonly metadata?: Record<string, unknown>;
  readonly provider?: {
    readonly id: string;
    readonly kind: string;
    readonly target: string;
  };
}

export interface TransformResult {
  readonly value: unknown;
  readonly input: unknown;
  readonly spec: TransformSpec;
}

const FILE_PREFIX = 'file://';
const INLINE_STRING_LABEL_MAX_LENGTH = 80;

function parseFileTransformReference(spec: string): {
  readonly filePath: string;
  readonly functionName?: string;
} {
  const ref = spec.slice(FILE_PREFIX.length);
  const lastColon = ref.lastIndexOf(':');
  if (lastColon > 1) {
    return {
      filePath: ref.slice(0, lastColon),
      functionName: ref.slice(lastColon + 1),
    };
  }
  return { filePath: ref };
}

function isJavaScriptFile(filePath: string): boolean {
  return ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].includes(path.extname(filePath));
}

async function loadFileTransform(spec: string): Promise<TransformFunction> {
  const { filePath, functionName } = parseFileTransformReference(spec);
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  if (!isJavaScriptFile(absolutePath)) {
    throw new Error(`Unsupported transform file format: ${spec}`);
  }

  const mod = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  const candidate = functionName ? mod[functionName] : (mod.default ?? mod);
  if (typeof candidate === 'function') {
    return candidate as TransformFunction;
  }
  throw new Error(
    functionName
      ? `Transform ${spec} must export function "${functionName}"`
      : `Transform ${spec} must export a function or default function`,
  );
}

function inlineTransformFunction(code: string): TransformFunction {
  return new Function(
    'output',
    'context',
    code.includes('\n') ? code : `return ${code}`,
  ) as TransformFunction;
}

function transformLabel(spec: TransformSpec): string {
  if (spec.startsWith(FILE_PREFIX)) {
    return '[file transform]';
  }
  const singleLine = spec.replace(/\s+/g, ' ').trim();
  const truncated =
    singleLine.length > INLINE_STRING_LABEL_MAX_LENGTH
      ? `${singleLine.slice(0, INLINE_STRING_LABEL_MAX_LENGTH - 1)}...`
      : singleLine;
  return `[inline transform]: ${truncated}`;
}

export function stringifyTransformOutput(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function contentToTransformInput(content: string | readonly Content[] | undefined): unknown {
  if (content === undefined) {
    return '';
  }
  return content;
}

export async function applyTransform(
  spec: TransformSpec,
  input: unknown,
  context: TransformContext,
): Promise<TransformResult> {
  try {
    const fn = spec.startsWith(FILE_PREFIX)
      ? await loadFileTransform(spec)
      : inlineTransformFunction(spec);
    const value = await Promise.resolve(fn(input, context));
    if (value === undefined || value === null) {
      throw new Error('Transform function did not return a value');
    }
    return { value, input, spec };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Transform failed (${transformLabel(spec)}): ${message}`);
  }
}
