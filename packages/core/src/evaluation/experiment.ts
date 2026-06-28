import { createHash } from 'node:crypto';

import type { EvalRunOverride, TrialStrategy } from './types.js';

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

export type ExperimentRepeatWire = {
  readonly count?: number;
  readonly strategy?: TrialStrategy;
  readonly cost_limit_usd?: number;
  readonly costLimitUsd?: number;
};

export type ExperimentRepeat = {
  readonly count: number;
  readonly strategy: TrialStrategy;
  readonly costLimitUsd?: number;
};

export type ExperimentConfigWire = {
  readonly name?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly ExperimentTargetRefWire[];
  readonly model?: string;
  readonly agent_options?: Record<string, unknown>;
  readonly repeat?: ExperimentRepeatWire;
  readonly runs?: number;
  readonly early_exit?: boolean;
  readonly timeout_seconds?: number;
  readonly workers?: number;
  readonly threshold?: number;
  readonly budget_usd?: number;
  readonly sandbox?: ExperimentSandbox;
  readonly workspace?: never;
};

export type ExperimentConfig = {
  readonly name?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly ExperimentTargetRef[];
  readonly model?: string;
  readonly agentOptions?: Record<string, unknown>;
  readonly repeat?: ExperimentRepeat;
  readonly runs?: number;
  readonly earlyExit?: boolean;
  readonly timeoutSeconds?: number;
  readonly workers?: number;
  readonly threshold?: number;
  readonly budgetUsd?: number;
  readonly sandbox?: ExperimentSandbox;
  readonly fingerprint?: string;
};

export type ExperimentArtifactMetadata = {
  readonly name?: string;
  readonly fingerprint?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly string[];
  readonly model?: string;
  readonly repeat?: {
    readonly count: number;
    readonly strategy: TrialStrategy;
    readonly cost_limit_usd?: number;
  };
  readonly runs?: number;
  readonly early_exit?: boolean;
  readonly timeout_seconds?: number;
  readonly workers?: number;
  readonly threshold?: number;
  readonly budget_usd?: number;
  readonly sandbox?: ExperimentSandbox;
};

const VALID_SANDBOXES: ReadonlySet<string> = new Set(['auto', 'docker', 'vercel']);
const VALID_REPEAT_STRATEGIES: ReadonlySet<string> = new Set([
  'pass_at_k',
  'pass_all',
  'mean',
  'confidence_interval',
]);

const RUN_OVERRIDE_FIELDS: ReadonlySet<string> = new Set([
  'threshold',
  'repeat',
  'timeout_seconds',
  'timeoutSeconds',
  'budget_usd',
  'budgetUsd',
]);

export function normalizeExperimentConfig(rawConfig: unknown): ExperimentConfig {
  if (!isRecord(rawConfig)) {
    throw new Error('Experiment config must be an object.');
  }

  const name = readOptionalString(rawConfig.name, 'name');
  const agent = readOptionalString(rawConfig.agent, 'agent');
  const target = readOptionalString(rawConfig.target, 'target');
  const targets = readTargets(rawConfig.targets);
  const model = readOptionalString(rawConfig.model, 'model');
  const agentOptions = readOptionalRecord(rawConfig.agent_options ?? rawConfig.agentOptions);
  rejectExperimentLifecycleCommands(rawConfig);
  const repeat = readRepeat(rawConfig.repeat);
  const runs = readOptionalPositiveInteger(rawConfig.runs, 'runs');
  if (repeat !== undefined && runs !== undefined) {
    throw new Error('Experiment repeat and runs cannot both be set. Use repeat for AgentV config.');
  }
  const earlyExit = readOptionalBoolean(rawConfig.early_exit ?? rawConfig.earlyExit, 'early_exit');
  const timeoutSeconds = readOptionalPositiveNumber(
    rawConfig.timeout_seconds ?? rawConfig.timeoutSeconds,
    'timeout_seconds',
  );
  const workers = readOptionalPositiveInteger(rawConfig.workers, 'workers');
  const threshold = readOptionalThreshold(rawConfig.threshold);
  const budgetUsd = readOptionalPositiveNumber(
    rawConfig.budget_usd ?? rawConfig.budgetUsd,
    'budget_usd',
  );
  const sandbox = readOptionalSandbox(rawConfig.sandbox);
  rejectExperimentWorkspace(rawConfig.workspace);

  const configWithoutFingerprint: Omit<ExperimentConfig, 'fingerprint'> = {
    ...(name !== undefined && { name }),
    ...(agent !== undefined && { agent }),
    ...(target !== undefined && { target }),
    ...(targets !== undefined && { targets }),
    ...(model !== undefined && { model }),
    ...(agentOptions !== undefined && { agentOptions }),
    ...(repeat !== undefined && { repeat }),
    ...(runs !== undefined && { runs }),
    ...(earlyExit !== undefined && { earlyExit }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(workers !== undefined && { workers }),
    ...(threshold !== undefined && { threshold }),
    ...(budgetUsd !== undefined && { budgetUsd }),
    ...(sandbox !== undefined && { sandbox }),
  };

  return {
    ...configWithoutFingerprint,
    fingerprint: fingerprintExperimentConfig(configWithoutFingerprint),
  };
}

export function normalizeExperimentRunOverride(rawConfig: unknown): EvalRunOverride {
  if (!isRecord(rawConfig)) {
    throw new Error('Run override must be an object.');
  }
  for (const key of Object.keys(rawConfig)) {
    if (!RUN_OVERRIDE_FIELDS.has(key)) {
      throw new Error(
        `Invalid run override field '${key}'. Scoped run overrides support only threshold, repeat, timeout_seconds, and budget_usd.`,
      );
    }
  }

  const threshold = readOptionalThreshold(rawConfig.threshold);
  const repeat = readRepeat(rawConfig.repeat);
  const timeoutSeconds = readOptionalPositiveNumber(
    rawConfig.timeout_seconds ?? rawConfig.timeoutSeconds,
    'timeout_seconds',
  );
  const budgetUsd = readOptionalPositiveNumber(
    rawConfig.budget_usd ?? rawConfig.budgetUsd,
    'budget_usd',
  );

  return {
    ...(threshold !== undefined && { threshold }),
    ...(repeat !== undefined && { repeat }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(budgetUsd !== undefined && { budgetUsd }),
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
    ...(config.fingerprint !== undefined && { fingerprint: config.fingerprint }),
    ...(config.agent !== undefined && { agent: config.agent }),
    ...(config.target !== undefined && { target: config.target }),
    ...(targets && targets.length > 0 && { targets }),
    ...(config.model !== undefined && { model: config.model }),
    ...(config.repeat !== undefined && {
      repeat: {
        count: config.repeat.count,
        strategy: config.repeat.strategy,
        ...(config.repeat.costLimitUsd !== undefined && {
          cost_limit_usd: config.repeat.costLimitUsd,
        }),
      },
    }),
    ...(config.runs !== undefined && { runs: config.runs }),
    ...(config.earlyExit !== undefined && { early_exit: config.earlyExit }),
    ...(config.timeoutSeconds !== undefined && { timeout_seconds: config.timeoutSeconds }),
    ...(config.workers !== undefined && { workers: config.workers }),
    ...(config.threshold !== undefined && { threshold: config.threshold }),
    ...(config.budgetUsd !== undefined && { budget_usd: config.budgetUsd }),
    ...(config.sandbox !== undefined && { sandbox: config.sandbox }),
  };
}

function readRepeat(raw: unknown): ExperimentRepeat | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new Error('Experiment repeat must be an object.');
  }
  const count = readRequiredPositiveInteger(raw.count, 'repeat.count');
  const strategy = readOptionalRepeatStrategy(raw.strategy);
  const costLimitUsd = readOptionalNonNegativeNumber(
    raw.cost_limit_usd ?? raw.costLimitUsd,
    'repeat.cost_limit_usd',
  );

  return {
    count,
    strategy: strategy ?? 'pass_at_k',
    ...(costLimitUsd !== undefined && { costLimitUsd }),
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

function readRequiredPositiveInteger(raw: unknown, location: string): number {
  const value = readOptionalPositiveInteger(raw, location);
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

function readOptionalRepeatStrategy(raw: unknown): TrialStrategy | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || !VALID_REPEAT_STRATEGIES.has(raw)) {
    throw new Error(
      "Experiment repeat.strategy must be one of 'pass_at_k', 'mean', or 'confidence_interval'.",
    );
  }
  return raw as TrialStrategy;
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

function readOptionalNonNegativeNumber(raw: unknown, location: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`Experiment ${location} must be a non-negative number.`);
  }
  return raw;
}

function readOptionalThreshold(raw: unknown): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'number' || raw < 0 || raw > 1) {
    throw new Error('Experiment threshold must be a number between 0 and 1.');
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

function rejectExperimentWorkspace(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  throw new Error(
    'Experiment workspace has been removed from eval YAML. Put machine-local workspace_path/workspace_mode in .agentv/config.local.yaml under execution, or pass --workspace-path/--workspace-mode. Keep portable task setup in top-level workspace.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectExperimentLifecycleCommands(rawConfig: Record<string, unknown>): void {
  if (rawConfig.setup !== undefined) {
    throw new Error(
      'Experiment setup is not supported. Use workspace.hooks for repo setup or targets[].hooks for runner setup.',
    );
  }
  if (rawConfig.scripts !== undefined) {
    throw new Error(
      'Experiment scripts are not supported. Use workspace.hooks for repo setup or targets[].hooks for runner setup.',
    );
  }
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
