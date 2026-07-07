import { createHash } from 'node:crypto';

import type { EvalRunOverride, TrialStrategy } from './types.js';

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

export type ExperimentRepeatInput = number;

export type ExperimentRepeat = {
  readonly count: number;
  readonly strategy: TrialStrategy;
};

export type ExperimentConfigWire = {
  readonly name?: string;
  readonly agent?: string;
  readonly target?: string;
  readonly targets?: readonly ExperimentTargetRefWire[];
  readonly model?: string;
  readonly agent_options?: Record<string, unknown>;
  readonly repeat?: ExperimentRepeatInput;
  readonly timeout_seconds?: number;
  readonly threshold?: number;
  readonly budget_usd?: number;
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
  readonly timeoutSeconds?: number;
  readonly threshold?: number;
  readonly budgetUsd?: number;
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
  };
  readonly timeout_seconds?: number;
  readonly threshold?: number;
  readonly budget_usd?: number;
};

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
  rejectLegacyTopLevelRepeatFields(rawConfig);
  const repeat = readRepeat(rawConfig.repeat);
  const timeoutSeconds = readOptionalPositiveNumber(
    rawConfig.timeout_seconds ?? rawConfig.timeoutSeconds,
    'timeout_seconds',
  );
  rejectExperimentWorkers(rawConfig.workers);
  const threshold = readOptionalThreshold(rawConfig.threshold);
  const budgetUsd = readOptionalPositiveNumber(
    rawConfig.budget_usd ?? rawConfig.budgetUsd,
    'budget_usd',
  );
  rejectExperimentWorkspace(rawConfig.workspace);

  const configWithoutFingerprint: Omit<ExperimentConfig, 'fingerprint'> = {
    ...(name !== undefined && { name }),
    ...(agent !== undefined && { agent }),
    ...(target !== undefined && { target }),
    ...(targets !== undefined && { targets }),
    ...(model !== undefined && { model }),
    ...(agentOptions !== undefined && { agentOptions }),
    ...(repeat !== undefined && { repeat }),
    ...(timeoutSeconds !== undefined && { timeoutSeconds }),
    ...(threshold !== undefined && { threshold }),
    ...(budgetUsd !== undefined && { budgetUsd }),
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
      },
    }),
    ...(config.timeoutSeconds !== undefined && { timeout_seconds: config.timeoutSeconds }),
    ...(config.threshold !== undefined && { threshold: config.threshold }),
    ...(config.budgetUsd !== undefined && { budget_usd: config.budgetUsd }),
  };
}

function readRepeat(raw: unknown): ExperimentRepeat | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return {
      count: readRequiredPositiveInteger(raw, 'repeat'),
      strategy: 'pass_any',
    };
  }
  throw new Error(
    'Experiment repeat must be a positive integer. The repeat object shape has been removed; use evaluate_options.repeat: 2.',
  );
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

function rejectLegacyTopLevelRepeatFields(rawConfig: Record<string, unknown>): void {
  if (rawConfig.runs !== undefined) {
    throw new Error(
      "Experiment top-level 'runs' has been removed. Use a positive integer evaluate_options.repeat instead.",
    );
  }
  if (rawConfig.early_exit !== undefined || rawConfig.earlyExit !== undefined) {
    throw new Error(
      "Experiment top-level 'early_exit' has been removed. Use a positive integer evaluate_options.repeat instead.",
    );
  }
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
    'Experiment workspace has been removed from eval YAML. Put machine-local workspace_path in .agentv/config.local.yaml under execution, or pass --workspace-path. Keep portable coding-agent testbed setup in environment.',
  );
}

function rejectExperimentWorkers(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  throw new Error(
    'Experiment workers has been removed from eval YAML. Set authored eval concurrency with evaluate_options.max_concurrency.',
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
