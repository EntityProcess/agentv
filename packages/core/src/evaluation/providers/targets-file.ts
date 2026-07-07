import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseYamlValue } from '../yaml-loader.js';
import { normalizeProviderDefinition } from './targets.js';
import { TARGETS_SCHEMA_V2 } from './types.js';
import type { ProviderDefinition } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractProvidersArray(parsed: unknown, absolutePath: string): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `providers catalog at ${absolutePath} must be a YAML array or an object with a 'providers' field`,
    );
  }
  if (parsed.targets !== undefined) {
    throw new Error(
      `Provider catalog at ${absolutePath} uses removed 'targets'. Use 'providers'; map targets[].id to providers[].label and targets[].provider to providers[].id.`,
    );
  }
  const providers = parsed.providers;
  if (!Array.isArray(providers)) {
    throw new Error(`providers catalog at ${absolutePath} must have a 'providers' array`);
  }
  return providers;
}

function assertProviderDefinition(
  value: unknown,
  index: number,
  filePath: string,
): ProviderDefinition {
  if (!isRecord(value)) {
    throw new Error(`providers entry at index ${index} in ${filePath} must be an object`);
  }

  const id = value.id;

  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`providers entry at index ${index} in ${filePath} is missing a valid 'id'`);
  }

  return normalizeProviderDefinition(value, { location: `providers[${index}]` });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readProviderDefinitions(
  filePath: string,
): Promise<readonly ProviderDefinition[]> {
  const absolutePath = path.resolve(filePath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`providers.yaml not found at ${absolutePath}`);
  }

  const raw = await readFile(absolutePath, 'utf8');
  const parsed = parseYamlValue(raw);

  const providers = extractProvidersArray(parsed, absolutePath);
  const definitions = providers.map((entry, index) =>
    assertProviderDefinition(entry, index, absolutePath),
  );
  return definitions;
}

export function listProviderLabels(definitions: readonly ProviderDefinition[]): readonly string[] {
  return definitions.map((definition) => definition.name);
}
