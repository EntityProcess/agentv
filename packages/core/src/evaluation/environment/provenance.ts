import { createHash } from 'node:crypto';

import type {
  DockerEnvironmentRecipe,
  EnvironmentRecipe,
  EnvironmentSetupConfig,
} from '../loaders/environment-recipe.js';
import type {
  EnvironmentRecipeProvenance,
  EnvironmentSetupProvenance,
  JsonObject,
  JsonValue,
} from '../types.js';
import type { EnvironmentSetupExecution } from '../workspace/setup.js';

const SECRET_KEY_PATTERN =
  /(api[_-]?key|auth|credential|password|passwd|private[_-]?key|secret|token)/i;

export function buildEnvironmentRecipeProvenance(params: {
  readonly environment: EnvironmentRecipe | undefined;
  readonly setupExecutions?: readonly EnvironmentSetupExecution[];
}): EnvironmentRecipeProvenance | undefined {
  const environment = params.environment;
  if (!environment) {
    return undefined;
  }
  const secretValues = collectSecretValues(environment);
  const setupExecutions = params.setupExecutions
    ?.filter((execution) => execution.workdir === environment.workdir)
    .map((execution) => redactSetupExecution(execution, secretValues));
  const repoProvenance = setupExecutions ? extractRepoProvenance(setupExecutions) : undefined;
  return {
    schemaVersion: 'agentv.environment_provenance.v1',
    authoredKind: environment.authoredReference ? 'file' : 'inline',
    ...(environment.authoredReference ? { authoredReference: environment.authoredReference } : {}),
    ...(environment.recipeFilePath ? { recipeFilePath: environment.recipeFilePath } : {}),
    ...(environment.recipeFileSha256 ? { recipeFileSha256: environment.recipeFileSha256 } : {}),
    recipeSha256: environment.recipeSha256 ?? fallbackRecipeSha256(environment),
    type: environment.type,
    sourceDir: environment.sourceDir,
    workdir: environment.workdir,
    ...(environment.setup ? { setup: redactSetupConfig(environment.setup, secretValues) } : {}),
    ...(setupExecutions && setupExecutions.length > 0 ? { setupExecutions } : {}),
    ...(environment.type === 'docker' ? { docker: dockerProvenance(environment) } : {}),
    ...(repoProvenance !== undefined ? { repoProvenance } : {}),
  };
}

function dockerProvenance(
  environment: DockerEnvironmentRecipe,
): EnvironmentRecipeProvenance['docker'] {
  const imageDigest = environment.image?.match(/@([^@\s]+)$/)?.[1];
  return {
    ...(environment.context ? { context: environment.context } : {}),
    ...(environment.dockerfile ? { dockerfile: environment.dockerfile } : {}),
    ...(environment.image ? { image: environment.image } : {}),
    ...(imageDigest ? { imageDigest } : {}),
  };
}

function fallbackRecipeSha256(environment: EnvironmentRecipe): string {
  return createHash('sha256')
    .update(
      stableJson({
        type: environment.type,
        workdir: environment.workdir,
        sourceDir: environment.sourceDir,
        setup: environment.setup,
        ...(environment.type === 'docker'
          ? {
              context: environment.context,
              dockerfile: environment.dockerfile,
              image: environment.image,
            }
          : {}),
      }),
    )
    .digest('hex');
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

function redactSetupConfig(
  setup: EnvironmentSetupConfig,
  secretValues: readonly string[],
): EnvironmentRecipeProvenance['setup'] {
  return {
    command: redactCommand(setup.command, secretValues),
    ...(setup.args ? { args: redactJsonObject(setup.args, secretValues) } : {}),
    ...(setup.env ? { env: redactStringRecord(setup.env, secretValues) } : {}),
    ...(setup.timeout_seconds !== undefined ? { timeoutSeconds: setup.timeout_seconds } : {}),
  };
}

function redactSetupExecution(
  execution: EnvironmentSetupExecution,
  secretValues: readonly string[],
): EnvironmentSetupProvenance {
  return {
    scope: execution.scope,
    name: execution.name,
    status: execution.status,
    testId: execution.testId,
    workdir: execution.workdir,
    ...(execution.command !== undefined
      ? { command: redactCommand(execution.command, secretValues) }
      : {}),
    ...(execution.cwd !== undefined ? { cwd: execution.cwd } : {}),
    ...(execution.output !== undefined
      ? { output: redactString(execution.output, secretValues) }
      : {}),
    ...(execution.error !== undefined
      ? { error: redactString(execution.error, secretValues) }
      : {}),
    ...(execution.exitCode !== undefined ? { exitCode: execution.exitCode } : {}),
  };
}

function redactCommand(
  command: EnvironmentSetupConfig['command'],
  secretValues: readonly string[],
): EnvironmentSetupConfig['command'] {
  if (typeof command === 'string') {
    return redactSecretAssignments(redactString(command, secretValues));
  }
  return command.map((part, index) => {
    const previous = index > 0 ? command[index - 1] : undefined;
    if (previous && isSecretKey(previous.replace(/^-+/, ''))) {
      return '<redacted>';
    }
    return redactSecretAssignments(redactString(part, secretValues));
  });
}

function redactJsonObject(value: JsonObject, secretValues: readonly string[]): JsonObject {
  return redactJsonValue(value, secretValues) as JsonObject;
}

function redactJsonValue(
  value: JsonValue,
  secretValues: readonly string[],
  key?: string,
): JsonValue {
  if (key && isSecretKey(key)) {
    return '<redacted>';
  }
  if (typeof value === 'string') {
    return redactString(value, secretValues);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry, secretValues));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactJsonValue(entryValue, secretValues, entryKey),
      ]),
    );
  }
  return value;
}

function redactStringRecord(
  value: Readonly<Record<string, string>>,
  secretValues: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSecretKey(key) ? '<redacted>' : redactString(entry, secretValues),
    ]),
  );
}

function collectSecretValues(environment: EnvironmentRecipe): string[] {
  const values: string[] = [];
  collectSecretValuesFromRecord(environment.env, values);
  collectSecretValuesFromRecord(environment.setup?.env, values);
  collectSecretValuesFromJson(environment.setup?.args, values);
  if (environment.type === 'docker') {
    collectSecretValuesFromRecord(environment.secrets, values);
  }
  return [...new Set(values.filter((value) => value.length >= 4))];
}

function collectSecretValuesFromRecord(
  record: Readonly<Record<string, string>> | undefined,
  values: string[],
): void {
  for (const [key, value] of Object.entries(record ?? {})) {
    if (isSecretKey(key)) {
      values.push(value);
    }
  }
}

function collectSecretValuesFromJson(
  value: JsonValue | undefined,
  values: string[],
  key?: string,
): void {
  if (value === undefined) {
    return;
  }
  if (key && isSecretKey(key) && typeof value === 'string') {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSecretValuesFromJson(entry, values);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      collectSecretValuesFromJson(entryValue, values, entryKey);
    }
  }
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function redactString(value: string, secretValues: readonly string[]): string {
  return secretValues.reduce((text, secret) => text.split(secret).join('<redacted>'), value);
}

function redactSecretAssignments(value: string): string {
  return value.replace(
    /((?:api[_-]?key|auth|credential|password|passwd|private[_-]?key|secret|token)[A-Z0-9_-]*=)([^\s]+)/gi,
    '$1<redacted>',
  );
}

function extractRepoProvenance(
  setupExecutions: readonly EnvironmentSetupProvenance[],
): JsonValue | undefined {
  for (const execution of setupExecutions) {
    const candidates = [execution.output, execution.error].filter(
      (entry): entry is string => !!entry,
    );
    for (const candidate of candidates) {
      const parsed = parseJsonCandidate(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, JsonValue>;
        if (record.repo_provenance !== undefined) {
          return record.repo_provenance;
        }
        if (record.repoProvenance !== undefined) {
          return record.repoProvenance;
        }
      }
    }
  }
  return undefined;
}

function parseJsonCandidate(value: string): JsonValue | undefined {
  const trimmed = value.trim();
  const candidates = [trimmed, ...trimmed.split(/\r?\n/).map((line) => line.trim())].filter(
    (line) => line.startsWith('{') && line.endsWith('}'),
  );
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as JsonValue;
    } catch {}
  }
  return undefined;
}
