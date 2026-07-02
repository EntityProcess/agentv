import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseYamlValue } from '../yaml-loader.js';
import { normalizeTargetDefinition } from './targets.js';
import { TARGETS_SCHEMA_V2 } from './types.js';
import type { TargetDefinition } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTargetsArray(parsed: Record<string, unknown>, absolutePath: string): unknown[] {
  const targets = parsed.targets;
  if (!Array.isArray(targets)) {
    throw new Error(`targets.yaml at ${absolutePath} must have a 'targets' array`);
  }
  return targets;
}

function assertTargetDefinition(value: unknown, index: number, filePath: string): TargetDefinition {
  if (!isRecord(value)) {
    throw new Error(`targets.yaml entry at index ${index} in ${filePath} must be an object`);
  }

  const label = value.label;
  const provider = value.provider;

  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error(
      `targets.yaml entry at index ${index} in ${filePath} is missing a valid 'label'`,
    );
  }

  if (typeof value.name === 'string' && value.name.trim().length > 0) {
    throw new Error(
      `targets.yaml entry '${label}' in ${filePath} uses removed field 'name'. Use 'label' for the AgentV target name.`,
    );
  }

  const hasUseTarget = typeof value.use_target === 'string' && value.use_target.trim().length > 0;
  if (!hasUseTarget && (typeof provider !== 'string' || provider.trim().length === 0)) {
    throw new Error(
      `targets.yaml entry '${label}' in ${filePath} is missing a valid 'provider' (or use use_target for delegation)`,
    );
  }

  return normalizeTargetDefinition(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTargetDefinitions(
  filePath: string,
): Promise<readonly TargetDefinition[]> {
  const absolutePath = path.resolve(filePath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`targets.yaml not found at ${absolutePath}`);
  }

  const raw = await readFile(absolutePath, 'utf8');
  const parsed = parseYamlValue(raw);

  if (!isRecord(parsed)) {
    throw new Error(`targets.yaml at ${absolutePath} must be a YAML object with a 'targets' field`);
  }

  const targets = extractTargetsArray(parsed, absolutePath);
  const definitions = targets.map((entry, index) =>
    assertTargetDefinition(entry, index, absolutePath),
  );
  return definitions;
}

export function listTargetNames(definitions: readonly TargetDefinition[]): readonly string[] {
  return definitions.map((definition) => definition.name);
}
