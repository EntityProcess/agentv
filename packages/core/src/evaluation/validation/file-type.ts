import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import type { FileType } from './types.js';

const SCHEMA_EVAL_V2 = 'agentv-eval-v2';
const SCHEMA_TARGETS_V2 = 'agentv-targets-v2.2';
const SCHEMA_CONFIG_V2 = 'agentv-config-v2';

/**
 * Detect file type by reading $schema field from YAML file.
 * If $schema is missing, infers type from filename/path:
 * - config.yaml under .agentv folder → 'config'
 * - targets.yaml under .agentv folder → 'targets'
 * - All other YAML files → 'eval' (default)
 */
export async function detectFileType(filePath: string): Promise<FileType> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = parse(content) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return inferFileTypeFromPath(filePath);
    }

    const record = parsed as Record<string, unknown>;
    const schema = record.$schema;

    if (typeof schema !== 'string') {
      // No $schema field - infer from path
      return inferFileTypeFromPath(filePath);
    }

    switch (schema) {
      case SCHEMA_EVAL_V2:
        return 'eval';
      case SCHEMA_TARGETS_V2:
        return 'targets';
      case SCHEMA_CONFIG_V2:
        return 'config';
      default:
        // Unknown schema - infer from path
        return inferFileTypeFromPath(filePath);
    }
  } catch {
    return inferFileTypeFromPath(filePath);
  }
}

/**
 * Infer file type from filename and directory path.
 */
function inferFileTypeFromPath(filePath: string): FileType {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  const basename = path.basename(filePath);

  // Check if file is under .agentv folder
  if (normalized.includes('/.agentv/')) {
    if (basename === 'config.yaml' || basename === 'config.yml') {
      return 'config';
    }
    if (basename === 'targets.yaml' || basename === 'targets.yml') {
      return 'targets';
    }
  }

  // Default to eval file
  return 'eval';
}

/**
 * Check if a schema value is a valid AgentV schema identifier.
 */
export function isValidSchema(schema: unknown): boolean {
  return schema === SCHEMA_EVAL_V2 || schema === SCHEMA_TARGETS_V2 || schema === SCHEMA_CONFIG_V2;
}

/**
 * Get the expected schema for a file type.
 */
export function getExpectedSchema(fileType: FileType): string | undefined {
  switch (fileType) {
    case 'eval':
      return SCHEMA_EVAL_V2;
    case 'targets':
      return SCHEMA_TARGETS_V2;
    case 'config':
      return SCHEMA_CONFIG_V2;
    default:
      return undefined;
  }
}
