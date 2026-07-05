import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { interpolateEnv } from '../interpolation.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';

const FILE_PROTOCOL = 'file://';

export type EnvironmentSetupConfig = {
  readonly command: string | readonly string[];
  readonly args?: JsonObject;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout_seconds?: number;
};

export type HostEnvironmentRecipe = {
  readonly type: 'host';
  readonly workdir: string;
  readonly setup?: EnvironmentSetupConfig;
  readonly env?: Readonly<Record<string, string>>;
  readonly recipeFilePath?: string;
};

export type DockerEnvironmentMount = {
  readonly source: string;
  readonly target: string;
  readonly access?: 'ro' | 'rw';
  readonly read_only?: boolean;
};

export type DockerEnvironmentResources = {
  readonly cpus?: number;
  readonly memory?: string;
  readonly disk?: string;
  readonly gpu?: boolean | string;
};

export type DockerEnvironmentRecipe = {
  readonly type: 'docker';
  readonly workdir: string;
  readonly context?: string;
  readonly dockerfile?: string;
  readonly image?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly resources?: DockerEnvironmentResources;
  readonly mounts?: readonly DockerEnvironmentMount[];
  readonly secrets?: Readonly<Record<string, string>>;
  readonly setup?: EnvironmentSetupConfig;
  readonly recipeFilePath?: string;
};

export type EnvironmentRecipe = HostEnvironmentRecipe | DockerEnvironmentRecipe;

export async function resolveEnvironmentRecipe(
  raw: unknown,
  evalFileDir: string,
  location = 'environment',
): Promise<EnvironmentRecipe | undefined> {
  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw === 'string') {
    if (!raw.startsWith(FILE_PROTOCOL)) {
      throw new Error(
        `${location} must be an inline recipe object or a file:// reference to a recipe file.`,
      );
    }
    const recipePath = resolveReferencePath(raw, evalFileDir);
    let parsed: unknown;
    try {
      parsed = interpolateEnv(parseYamlValue(await readFile(recipePath, 'utf8')), process.env);
    } catch (error) {
      throw new Error(
        `${location} recipe file not found or unreadable: ${raw} (${(error as Error).message})`,
      );
    }
    if (isJsonObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'environment')) {
      throw new Error(
        `${location} recipe file ${recipePath} must contain the environment recipe directly, not an object wrapped in 'environment'.`,
      );
    }
    return parseEnvironmentRecipe(parsed, path.dirname(recipePath), location, recipePath);
  }

  return parseEnvironmentRecipe(raw, evalFileDir, location);
}

function resolveReferencePath(reference: string, evalFileDir: string): string {
  const filePath = reference.slice(FILE_PROTOCOL.length);
  return path.isAbsolute(filePath) ? filePath : path.resolve(evalFileDir, filePath);
}

function parseEnvironmentRecipe(
  raw: unknown,
  baseDir: string,
  location: string,
  recipeFilePath?: string,
): EnvironmentRecipe {
  if (!isJsonObject(raw)) {
    throw new Error(`${location} must be an object with type: host|docker and workdir.`);
  }
  const type = raw.type;
  if (type !== 'host' && type !== 'docker') {
    throw new Error(`${location}.type must be 'host' or 'docker'.`);
  }

  const workdir = readRequiredString(raw.workdir, `${location}.workdir`);
  const setup = parseSetup(raw.setup, `${location}.setup`);
  const env = parseStringRecord(raw.env, `${location}.env`);

  if (type === 'host') {
    assertNoUnknownFields(raw, location, ['type', 'workdir', 'setup', 'env']);
    return {
      type,
      workdir: resolveHostPath(workdir, baseDir),
      ...(setup !== undefined && { setup }),
      ...(env !== undefined && { env }),
      ...(recipeFilePath !== undefined && { recipeFilePath }),
    };
  }

  assertNoUnknownFields(raw, location, [
    'type',
    'workdir',
    'context',
    'dockerfile',
    'image',
    'env',
    'resources',
    'mounts',
    'secrets',
    'setup',
  ]);
  const context = readOptionalString(raw.context, `${location}.context`);
  const dockerfile = readOptionalString(raw.dockerfile, `${location}.dockerfile`);
  const image = readOptionalString(raw.image, `${location}.image`);
  const secrets = parseStringRecord(raw.secrets, `${location}.secrets`);
  if (!context && !image) {
    throw new Error(`${location} docker recipes must define either 'image' or 'context'.`);
  }
  return {
    type,
    workdir,
    ...(context !== undefined && { context: resolveHostPath(context, baseDir) }),
    ...(dockerfile !== undefined && { dockerfile: resolveHostPath(dockerfile, baseDir) }),
    ...(image !== undefined && { image }),
    ...(env !== undefined && { env }),
    ...(parseResources(raw.resources, `${location}.resources`) ?? {}),
    ...(parseMounts(raw.mounts, `${location}.mounts`, baseDir) ?? {}),
    ...(secrets !== undefined && { secrets }),
    ...(setup !== undefined && { setup }),
    ...(recipeFilePath !== undefined && { recipeFilePath }),
  };
}

function resolveHostPath(value: string, baseDir: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function parseSetup(
  raw: JsonValue | undefined,
  location: string,
): EnvironmentSetupConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isJsonObject(raw)) {
    throw new Error(`${location} must be an object.`);
  }
  assertNoUnknownFields(raw, location, ['command', 'args', 'env', 'timeout_seconds']);
  const command = raw.command;
  if (
    !(
      typeof command === 'string' ||
      (Array.isArray(command) &&
        command.length > 0 &&
        command.every((entry) => typeof entry === 'string' && entry.trim().length > 0))
    )
  ) {
    throw new Error(`${location}.command must be a non-empty string or argv array.`);
  }
  const args = raw.args;
  if (args !== undefined && !isJsonObject(args)) {
    throw new Error(`${location}.args must be an object when provided.`);
  }
  const timeoutSeconds = raw.timeout_seconds;
  if (timeoutSeconds !== undefined && (typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0)) {
    throw new Error(`${location}.timeout_seconds must be a positive number.`);
  }
  const env = parseStringRecord(raw.env, `${location}.env`);
  return {
    command,
    ...(isJsonObject(args) ? { args } : {}),
    ...(env !== undefined && { env }),
    ...(typeof timeoutSeconds === 'number' ? { timeout_seconds: timeoutSeconds } : {}),
  };
}

function parseResources(
  raw: JsonValue | undefined,
  location: string,
): { readonly resources?: DockerEnvironmentResources } | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isJsonObject(raw)) {
    throw new Error(`${location} must be an object.`);
  }
  assertNoUnknownFields(raw, location, ['cpus', 'memory', 'disk', 'gpu']);
  const resources: DockerEnvironmentResources = {
    ...(typeof raw.cpus === 'number' && raw.cpus > 0 ? { cpus: raw.cpus } : {}),
    ...(typeof raw.memory === 'string' && raw.memory.trim().length > 0
      ? { memory: raw.memory.trim() }
      : {}),
    ...(typeof raw.disk === 'string' && raw.disk.trim().length > 0
      ? { disk: raw.disk.trim() }
      : {}),
    ...(typeof raw.gpu === 'boolean' || typeof raw.gpu === 'string' ? { gpu: raw.gpu } : {}),
  };
  if (raw.cpus !== undefined && resources.cpus === undefined) {
    throw new Error(`${location}.cpus must be a positive number.`);
  }
  if (raw.memory !== undefined && resources.memory === undefined) {
    throw new Error(`${location}.memory must be a non-empty string.`);
  }
  if (raw.disk !== undefined && resources.disk === undefined) {
    throw new Error(`${location}.disk must be a non-empty string.`);
  }
  if (raw.gpu !== undefined && resources.gpu === undefined) {
    throw new Error(`${location}.gpu must be a boolean or string.`);
  }
  return Object.keys(resources).length > 0 ? { resources } : undefined;
}

function parseMounts(
  raw: JsonValue | undefined,
  location: string,
  baseDir: string,
): { readonly mounts?: readonly DockerEnvironmentMount[] } | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${location} must be an array.`);
  }
  const mounts = raw.map((entry, index) => {
    const entryLocation = `${location}[${index}]`;
    if (!isJsonObject(entry)) {
      throw new Error(`${entryLocation} must be an object.`);
    }
    assertNoUnknownFields(entry, entryLocation, ['source', 'target', 'access', 'read_only']);
    const source = readRequiredString(entry.source, `${entryLocation}.source`);
    const target = readRequiredString(entry.target, `${entryLocation}.target`);
    const access = entry.access;
    if (access !== undefined && access !== 'ro' && access !== 'rw') {
      throw new Error(`${entryLocation}.access must be 'ro' or 'rw'.`);
    }
    const normalizedAccess: DockerEnvironmentMount['access'] =
      access === 'ro' || access === 'rw' ? access : undefined;
    if (entry.read_only !== undefined && typeof entry.read_only !== 'boolean') {
      throw new Error(`${entryLocation}.read_only must be a boolean.`);
    }
    return {
      source: resolveHostPath(source, baseDir),
      target,
      ...(normalizedAccess !== undefined && { access: normalizedAccess }),
      ...(typeof entry.read_only === 'boolean' && { read_only: entry.read_only }),
    };
  });
  return { mounts };
}

function parseStringRecord(
  raw: JsonValue | undefined,
  location: string,
): Readonly<Record<string, string>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isJsonObject(raw)) {
    throw new Error(`${location} must be an object of string values.`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      throw new Error(`${location}.${key} must be a string.`);
    }
    result[key] = value;
  }
  return result;
}

function readRequiredString(value: JsonValue | undefined, location: string): string {
  const result = readOptionalString(value, location);
  if (result === undefined) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return result;
}

function readOptionalString(value: JsonValue | undefined, location: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNoUnknownFields(
  raw: JsonObject,
  location: string,
  allowed: readonly string[],
): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(raw).find((key) => !allowedFields.has(key));
  if (unknown) {
    throw new Error(`${location}.${unknown} is not supported in environment recipes.`);
  }
}
