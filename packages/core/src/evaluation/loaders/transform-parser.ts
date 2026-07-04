import path from 'node:path';

import type { TransformSpec } from '../output-transform.js';
import type { JsonValue } from '../types.js';
import { resolveFileReference } from './file-resolver.js';

const FILE_PREFIX = 'file://';

function splitFileTransform(value: string): {
  readonly filePath: string;
  readonly functionName?: string;
} {
  const rawPath = value.slice(FILE_PREFIX.length);
  const lastColon = rawPath.lastIndexOf(':');
  if (lastColon > 1) {
    return {
      filePath: rawPath.slice(0, lastColon),
      functionName: rawPath.slice(lastColon + 1),
    };
  }
  return { filePath: rawPath };
}

export async function parseTransformSpec(
  rawValue: JsonValue | undefined,
  searchRoots: readonly string[],
  label: string,
): Promise<TransformSpec | undefined> {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error(`${label}: transform must be a non-empty string`);
  }

  const trimmed = rawValue.trim();
  if (!trimmed.startsWith(FILE_PREFIX)) {
    return trimmed;
  }

  const { filePath, functionName } = splitFileTransform(trimmed);
  const resolved = await resolveFileReference(filePath, searchRoots);
  if (!resolved.resolvedPath) {
    throw new Error(
      `${label}: transform file not found: ${resolved.displayPath}${
        resolved.attempted.length > 0
          ? `\n${resolved.attempted.map((attempt) => `  Tried: ${attempt}`).join('\n')}`
          : ''
      }`,
    );
  }

  const absolutePath = path.resolve(resolved.resolvedPath);
  return `${FILE_PREFIX}${absolutePath}${functionName ? `:${functionName}` : ''}`;
}
