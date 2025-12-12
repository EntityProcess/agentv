import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { TARGETS_SCHEMA_V2 } from "./types.js";
import type { TargetDefinition } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const name = value.name;
  const provider = value.provider;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(
      `targets.yaml entry at index ${index} in ${filePath} is missing a valid 'name'`
    );
  }

  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new Error(`targets.yaml entry '${name}' in ${filePath} is missing a valid 'provider'`);
  }

  // Pass through all properties from the YAML to support the flattened schema
  // This includes all provider-specific settings at the top level
  return value as unknown as TargetDefinition;
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
  filePath: string
): Promise<readonly TargetDefinition[]> {
  const absolutePath = path.resolve(filePath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`targets.yaml not found at ${absolutePath}`);
  }

  const raw = await readFile(absolutePath, "utf8");
  const parsed = parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`targets.yaml at ${absolutePath} must be a YAML object with a 'targets' field`);
  }

  const targets = extractTargetsArray(parsed, absolutePath);
  const definitions = targets.map((entry, index) =>
    assertTargetDefinition(entry, index, absolutePath)
  );
  return definitions;
}

export function listTargetNames(definitions: readonly TargetDefinition[]): readonly string[] {
  return definitions.map((definition) => definition.name);
}
