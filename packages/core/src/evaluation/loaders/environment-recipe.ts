import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { interpolateEnv } from '../interpolation.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isJsonObject } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';

const FILE_PROTOCOL = 'file://';

export type EnvironmentSetupConfig = {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
};

type EnvironmentRecipeSource = {
  readonly authoredReference?: string;
  readonly recipeFilePath?: string;
  readonly recipeFileSha256?: string;
  readonly recipeSha256?: string;
  readonly sourceDir: string;
};

export type HostEnvironmentRecipe = {
  readonly type: 'host';
  readonly workdir: string;
  readonly setup?: EnvironmentSetupConfig;
  readonly env?: Readonly<Record<string, string>>;
} & EnvironmentRecipeSource;

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
} & EnvironmentRecipeSource;

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
    let recipeText: string;
    try {
      recipeText = await readFile(recipePath, 'utf8');
      parsed = interpolateEnv(parseYamlValue(recipeText), process.env);
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
    return parseEnvironmentRecipe(parsed, path.dirname(recipePath), location, {
      authoredReference: raw,
      recipeFilePath: recipePath,
      recipeFileSha256: sha256(recipeText),
      recipeSha256: sha256(stableJson(parsed)),
    });
  }

  return parseEnvironmentRecipe(raw, evalFileDir, location, {
    recipeSha256: sha256(stableJson(raw)),
  });
}

function resolveReferencePath(reference: string, evalFileDir: string): string {
  const filePath = reference.slice(FILE_PROTOCOL.length);
  return path.isAbsolute(filePath) ? filePath : path.resolve(evalFileDir, filePath);
}

function parseEnvironmentRecipe(
  raw: unknown,
  baseDir: string,
  location: string,
  source: {
    readonly authoredReference?: string;
    readonly recipeFilePath?: string;
    readonly recipeFileSha256?: string;
    readonly recipeSha256: string;
  },
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
      sourceDir: baseDir,
      recipeSha256: source.recipeSha256,
      ...(setup !== undefined && { setup }),
      ...(env !== undefined && { env }),
      ...(source.authoredReference !== undefined && {
        authoredReference: source.authoredReference,
      }),
      ...(source.recipeFilePath !== undefined && { recipeFilePath: source.recipeFilePath }),
      ...(source.recipeFileSha256 !== undefined && { recipeFileSha256: source.recipeFileSha256 }),
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
    sourceDir: baseDir,
    recipeSha256: source.recipeSha256,
    ...(context !== undefined && { context: resolveHostPath(context, baseDir) }),
    ...(dockerfile !== undefined && { dockerfile: resolveHostPath(dockerfile, baseDir) }),
    ...(image !== undefined && { image }),
    ...(env !== undefined && { env }),
    ...(parseResources(raw.resources, `${location}.resources`) ?? {}),
    ...(parseMounts(raw.mounts, `${location}.mounts`, baseDir) ?? {}),
    ...(secrets !== undefined && { secrets }),
    ...(setup !== undefined && { setup }),
    ...(source.authoredReference !== undefined && { authoredReference: source.authoredReference }),
    ...(source.recipeFilePath !== undefined && { recipeFilePath: source.recipeFilePath }),
    ...(source.recipeFileSha256 !== undefined && { recipeFileSha256: source.recipeFileSha256 }),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
  assertNoUnknownFields(raw, location, ['command', 'cwd', 'timeout_ms']);
  const command = raw.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new Error(
      `${location}.command must be a non-empty string array, where command[0] is the executable and command[1...] are argv arguments. Use ["bash", "-lc", "..."] for shell behavior.`,
    );
  }
  const cwd = readOptionalString(raw.cwd, `${location}.cwd`);
  const timeoutMs = raw.timeout_ms;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs <= 0)) {
    throw new Error(`${location}.timeout_ms must be a positive number of milliseconds.`);
  }
  return {
    command,
    ...(cwd !== undefined && { cwd }),
    ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
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
    if (location.endsWith('.setup') && unknown === 'args') {
      throw new Error(
        `${location}.args is not supported. Put the executable and arguments in ${location}.command as a non-empty argv array, for example command: ["bash", "-lc", "..."].`,
      );
    }
    if (location.endsWith('.setup') && unknown === 'env') {
      throw new Error(
        `${location}.env is not supported. Use environment.env for environment-scoped variables.`,
      );
    }
    if (location.endsWith('.setup') && unknown === 'timeout_seconds') {
      throw new Error(
        `${location}.timeout_seconds is not supported. Use ${location}.timeout_ms with milliseconds.`,
      );
    }
    throw new Error(`${location}.${unknown} is not supported in environment recipes.`);
  }
}
