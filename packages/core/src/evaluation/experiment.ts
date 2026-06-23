import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseYamlValue } from './yaml-loader.js';

export type ExperimentSandbox = 'auto' | 'docker' | 'vercel';

export type ExperimentTargetRefWire =
  | string
  | {
      readonly name: string;
      readonly use_target?: string;
      readonly hooks?: Record<string, unknown>;
    };

export type ExperimentTargetRef =
  | string
  | {
      readonly name: string;
      readonly useTarget?: string;
      readonly hooks?: Record<string, unknown>;
    };

export type ExperimentScriptWire =
  | string
  | {
      readonly command?: string | readonly string[];
      readonly script?: string | readonly string[];
      readonly timeout_seconds?: number;
      readonly cwd?: string;
      readonly env?: Record<string, string>;
    };

export type ExperimentScript = {
  readonly command?: readonly string[];
  readonly script?: string | readonly string[];
  readonly timeoutSeconds?: number;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
};

export type ExperimentSetupFn = (sandbox: unknown) => void | Promise<void>;
export type ExperimentSetup = readonly ExperimentScript[] | ExperimentSetupFn;

export type ExperimentConfigWire = {
  readonly name?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly ExperimentTargetRefWire[];
  readonly model?: string;
  readonly agent_options?: Record<string, unknown>;
  readonly evals?: string | readonly string[];
  readonly scripts?: readonly ExperimentScriptWire[];
  readonly runs?: number;
  readonly early_exit?: boolean;
  readonly timeout_seconds?: number;
  readonly workers?: number;
  readonly budget_usd?: number;
  readonly sandbox?: ExperimentSandbox;
  readonly workspace?: Record<string, unknown>;
  readonly setup?: readonly ExperimentScriptWire[] | ExperimentSetupFn;
};

export type ExperimentConfig = {
  readonly name?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly ExperimentTargetRef[];
  readonly model?: string;
  readonly agentOptions?: Record<string, unknown>;
  readonly evals?: string | readonly string[];
  readonly scripts?: readonly ExperimentScript[];
  readonly runs?: number;
  readonly earlyExit?: boolean;
  readonly timeoutSeconds?: number;
  readonly workers?: number;
  readonly budgetUsd?: number;
  readonly sandbox?: ExperimentSandbox;
  readonly workspace?: Record<string, unknown>;
  readonly setup?: ExperimentSetup;
  readonly sourcePath?: string;
  readonly fingerprint?: string;
};

export type ExperimentArtifactMetadata = {
  readonly name?: string;
  readonly source_path?: string;
  readonly fingerprint?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly string[];
  readonly model?: string;
  readonly evals?: string | readonly string[];
  readonly runs?: number;
  readonly early_exit?: boolean;
  readonly timeout_seconds?: number;
  readonly workers?: number;
  readonly budget_usd?: number;
  readonly sandbox?: ExperimentSandbox;
};

type NormalizeOptions = {
  readonly sourcePath?: string;
};

const EXPERIMENT_FILE_EXTENSIONS = new Set(['.yaml', '.yml', '.ts', '.js', '.mts', '.mjs']);
const VALID_SANDBOXES: ReadonlySet<string> = new Set(['auto', 'docker', 'vercel']);

export function isExperimentFileReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    EXPERIMENT_FILE_EXTENSIONS.has(path.extname(trimmed).toLowerCase())
  );
}

export function deriveExperimentNameFromPath(filePath: string): string {
  return path
    .basename(filePath)
    .replace(/\.experiment\.(ya?ml|[cm]?[jt]s)$/i, '')
    .replace(/\.(ya?ml|[cm]?[jt]s)$/i, '');
}

export async function loadExperimentConfig(filePath: string): Promise<ExperimentConfig> {
  const resolvedPath = path.resolve(filePath);
  const ext = path.extname(resolvedPath).toLowerCase();
  let rawConfig: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    rawConfig = parseYamlValue(await readFile(resolvedPath, 'utf8'));
  } else if (EXPERIMENT_FILE_EXTENSIONS.has(ext)) {
    const moduleUrl = pathToFileURL(resolvedPath).href;
    const mod = await import(moduleUrl);
    rawConfig = mod.default ?? mod.config ?? mod;
  } else {
    throw new Error(
      `Unsupported experiment file extension '${ext}'. Use .yaml, .yml, .ts, .js, .mts, or .mjs.`,
    );
  }

  return normalizeExperimentConfig(rawConfig, { sourcePath: resolvedPath });
}

export function normalizeExperimentConfig(
  rawConfig: unknown,
  options: NormalizeOptions = {},
): ExperimentConfig {
  if (!isRecord(rawConfig)) {
    throw new Error('Experiment config must be an object.');
  }

  const name = readOptionalString(rawConfig.name, 'name');
  const agent = readOptionalString(rawConfig.agent, 'agent');
  const target = readOptionalString(rawConfig.target, 'target');
  const targets = readTargets(rawConfig.targets);
  const model = readOptionalString(rawConfig.model, 'model');
  const agentOptions = readOptionalRecord(rawConfig.agent_options ?? rawConfig.agentOptions);
  const evals = readOptionalStringOrStringArray(rawConfig.evals, 'evals');
  const scripts = readScriptArray(rawConfig.scripts, 'scripts');
  const runs = readOptionalPositiveInteger(rawConfig.runs, 'runs');
  const earlyExit = readOptionalBoolean(rawConfig.early_exit ?? rawConfig.earlyExit, 'early_exit');
  const timeoutSeconds = readOptionalPositiveNumber(
    rawConfig.timeout_seconds ?? rawConfig.timeoutSeconds,
    'timeout_seconds',
  );
  const workers = readOptionalPositiveInteger(rawConfig.workers, 'workers');
  const budgetUsd = readOptionalPositiveNumber(
    rawConfig.budget_usd ?? rawConfig.budgetUsd,
    'budget_usd',
  );
  const sandbox = readOptionalSandbox(rawConfig.sandbox);
  const workspace = readOptionalRecord(rawConfig.workspace);
  const setup = readSetup(rawConfig.setup);

  const configWithoutFingerprint: Omit<ExperimentConfig, 'fingerprint'> = {
    ...(name !== undefined && { name }),
    ...(agent !== undefined && { agent }),
    ...(target !== undefined && { target }),
    ...(targets !== undefined && { targets }),
    ...(model !== undefined && { model }),
    ...(agentOptions !== undefined && { agentOptions }),
    ...(evals !== undefined && { evals }),
    ...(scripts !== undefined && { scripts }),
    ...(runs !== undefined && { runs }),
    ...(earlyExit !== undefined && { earlyExit }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(workers !== undefined && { workers }),
    ...(budgetUsd !== undefined && { budgetUsd }),
    ...(sandbox !== undefined && { sandbox }),
    ...(workspace !== undefined && { workspace }),
    ...(setup !== undefined && { setup }),
    ...(options.sourcePath !== undefined && { sourcePath: options.sourcePath }),
  };

  return {
    ...configWithoutFingerprint,
    fingerprint: fingerprintExperimentConfig(configWithoutFingerprint),
  };
}

export function fingerprintExperimentConfig(config: ExperimentConfig): string {
  const stablePayload = toStableJsonValue(config);
  return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
}

export function buildExperimentArtifactMetadata(
  config: ExperimentConfig | undefined,
): ExperimentArtifactMetadata | undefined {
  if (!config) {
    return undefined;
  }
  const targets = config.targets
    ?.map((target) => (typeof target === 'string' ? target : target.name))
    .filter((target) => target.trim().length > 0);
  return {
    ...(config.name !== undefined && { name: config.name }),
    ...(config.sourcePath !== undefined && { source_path: config.sourcePath }),
    ...(config.fingerprint !== undefined && { fingerprint: config.fingerprint }),
    ...(config.agent !== undefined && { agent: config.agent }),
    ...(config.target !== undefined && { target: config.target }),
    ...(targets && targets.length > 0 && { targets }),
    ...(config.model !== undefined && { model: config.model }),
    ...(config.evals !== undefined && { evals: config.evals }),
    ...(config.runs !== undefined && { runs: config.runs }),
    ...(config.earlyExit !== undefined && { early_exit: config.earlyExit }),
    ...(config.timeoutSeconds !== undefined && { timeout_seconds: config.timeoutSeconds }),
    ...(config.workers !== undefined && { workers: config.workers }),
    ...(config.budgetUsd !== undefined && { budget_usd: config.budgetUsd }),
    ...(config.sandbox !== undefined && { sandbox: config.sandbox }),
  };
}

function readTargets(raw: unknown): readonly ExperimentTargetRef[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error('Experiment targets must be an array.');
  }
  return raw.map((entry, index): ExperimentTargetRef => {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      return entry.trim();
    }
    if (!isRecord(entry)) {
      throw new Error(`Experiment targets[${index}] must be a string or object.`);
    }
    const name = readRequiredString(entry.name, `targets[${index}].name`);
    const useTarget = readOptionalString(
      entry.use_target ?? entry.useTarget,
      `targets[${index}].use_target`,
    );
    const hooks = readOptionalRecord(entry.hooks);
    return {
      name,
      ...(useTarget !== undefined && { useTarget }),
      ...(hooks !== undefined && { hooks }),
    };
  });
}

function readScriptArray(raw: unknown, location: string): readonly ExperimentScript[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Experiment ${location} must be an array.`);
  }
  return raw.map((entry, index) => readScript(entry, `${location}[${index}]`));
}

function readSetup(raw: unknown): ExperimentSetup | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'function') {
    return raw as ExperimentSetupFn;
  }
  return readScriptArray(raw, 'setup');
}

function readScript(raw: unknown, location: string): ExperimentScript {
  if (typeof raw === 'string') {
    const script = raw.trim();
    if (!script) {
      throw new Error(`Experiment ${location} must not be empty.`);
    }
    return { script };
  }
  if (!isRecord(raw)) {
    throw new Error(`Experiment ${location} must be a string or object.`);
  }

  const command = readOptionalCommand(raw.command, `${location}.command`);
  const script = readOptionalStringOrStringArray(raw.script, `${location}.script`);
  if (command === undefined && script === undefined) {
    throw new Error(`Experiment ${location} must define command or script.`);
  }

  const timeoutSeconds = readOptionalPositiveNumber(
    raw.timeout_seconds ?? raw.timeoutSeconds,
    `${location}.timeout_seconds`,
  );
  const cwd = readOptionalString(raw.cwd, `${location}.cwd`);
  const env = readOptionalStringRecord(raw.env, `${location}.env`);

  return {
    ...(command !== undefined && { command }),
    ...(script !== undefined && { script }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(cwd !== undefined && { cwd }),
    ...(env !== undefined && { env }),
  };
}

function readOptionalCommand(raw: unknown, location: string): readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'string') {
    const command = raw.trim();
    if (!command) {
      throw new Error(`Experiment ${location} must not be empty.`);
    }
    return ['sh', '-c', command];
  }
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((entry) => typeof entry === 'string' && entry.trim())
  ) {
    return raw.map((entry) => entry.trim());
  }
  throw new Error(`Experiment ${location} must be a string or string array.`);
}

function readOptionalStringOrStringArray(
  raw: unknown,
  location: string,
): string | readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error(`Experiment ${location} must not be empty.`);
    }
    return trimmed;
  }
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((entry) => typeof entry === 'string' && entry.trim())
  ) {
    return raw.map((entry) => entry.trim());
  }
  throw new Error(`Experiment ${location} must be a string or string array.`);
}

function readOptionalString(raw: unknown, location: string): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Experiment ${location} must be a non-empty string.`);
  }
  return raw.trim();
}

function readRequiredString(raw: unknown, location: string): string {
  const value = readOptionalString(raw, location);
  if (value === undefined) {
    throw new Error(`Experiment ${location} is required.`);
  }
  return value;
}

function readOptionalBoolean(raw: unknown, location: string): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'boolean') {
    throw new Error(`Experiment ${location} must be a boolean.`);
  }
  return raw;
}

function readOptionalPositiveInteger(raw: unknown, location: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new Error(`Experiment ${location} must be a positive integer.`);
  }
  return raw;
}

function readOptionalPositiveNumber(raw: unknown, location: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Experiment ${location} must be a positive number.`);
  }
  return raw;
}

function readOptionalSandbox(raw: unknown): ExperimentSandbox | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || !VALID_SANDBOXES.has(raw)) {
    throw new Error("Experiment sandbox must be one of 'auto', 'docker', or 'vercel'.");
  }
  return raw as ExperimentSandbox;
}

function readOptionalRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error('Experiment object field must be an object.');
  }
  return raw;
}

function readOptionalStringRecord(
  raw: unknown,
  location: string,
): Record<string, string> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error(`Experiment ${location} must be an object.`);
  }
  const entries = Object.entries(raw);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    throw new Error(`Experiment ${location} values must be strings.`);
  }
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStableJsonValue(value: unknown): unknown {
  if (typeof value === 'function') {
    return '[function]';
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, toStableJsonValue(record[key])]),
  );
}
