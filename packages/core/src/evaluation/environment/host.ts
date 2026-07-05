import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { execFileWithStdin, execShellWithStdin } from '../../runtime/exec.js';
import type {
  EnvironmentSetupConfig,
  HostEnvironmentRecipe,
} from '../loaders/environment-recipe.js';
import type { JsonObject } from '../types.js';

export type HostEnvironmentSetupStatus = 'skipped' | 'success' | 'failed';

export interface HostEnvironmentSetupResult {
  readonly type: 'host';
  readonly workdir: string;
  readonly status: HostEnvironmentSetupStatus;
  readonly command?: readonly string[] | string;
  readonly cwd?: string;
  readonly args?: JsonObject;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export class HostEnvironmentSetupError extends Error {
  readonly result: HostEnvironmentSetupResult;

  constructor(message: string, result: HostEnvironmentSetupResult) {
    super(message);
    this.name = 'HostEnvironmentSetupError';
    this.result = result;
  }
}

function timeoutMs(setup: EnvironmentSetupConfig): number | undefined {
  return setup.timeout_seconds !== undefined ? setup.timeout_seconds * 1000 : undefined;
}

function setupPayload(recipe: HostEnvironmentRecipe): JsonObject {
  return {
    args: recipe.setup?.args ?? {},
    environment: {
      type: 'host',
      workdir: recipe.workdir,
    },
  };
}

function formatSetupFailure(result: HostEnvironmentSetupResult): string {
  const command =
    typeof result.command === 'string' ? result.command : (result.command ?? []).join(' ');
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const details = stderr || stdout;
  return details
    ? `environment.setup failed with exit code ${result.exitCode ?? 1} (${command}): ${details}`
    : `environment.setup failed with exit code ${result.exitCode ?? 1} (${command})`;
}

export async function prepareHostEnvironment(
  recipe: HostEnvironmentRecipe,
): Promise<HostEnvironmentSetupResult> {
  const workdir = path.resolve(recipe.workdir);
  await mkdir(workdir, { recursive: true });

  const setup = recipe.setup;
  if (!setup) {
    return {
      type: 'host',
      workdir,
      status: 'skipped',
    };
  }

  const cwd = path.resolve(recipe.sourceDir);
  const env = {
    ...(recipe.env ?? {}),
    ...(setup.env ?? {}),
    AGENTV_ENVIRONMENT_WORKDIR: workdir,
  };
  const payload = JSON.stringify(setupPayload({ ...recipe, workdir }), null, 2);

  let result: { readonly stdout: string; readonly stderr: string; readonly exitCode: number };
  try {
    result =
      typeof setup.command === 'string'
        ? await execShellWithStdin(setup.command, payload, {
            cwd,
            env,
            timeoutMs: timeoutMs(setup),
          })
        : await execFileWithStdin(setup.command, payload, {
            cwd,
            env,
            timeoutMs: timeoutMs(setup),
          });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure: HostEnvironmentSetupResult = {
      type: 'host',
      workdir,
      status: 'failed',
      command: setup.command,
      cwd,
      ...(setup.args !== undefined ? { args: setup.args } : {}),
      stderr: message,
      exitCode: 1,
    };
    throw new HostEnvironmentSetupError(formatSetupFailure(failure), failure);
  }

  const setupResult: HostEnvironmentSetupResult = {
    type: 'host',
    workdir,
    status: result.exitCode === 0 ? 'success' : 'failed',
    command: setup.command,
    cwd,
    ...(setup.args !== undefined ? { args: setup.args } : {}),
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };

  if (result.exitCode !== 0) {
    throw new HostEnvironmentSetupError(formatSetupFailure(setupResult), setupResult);
  }

  return setupResult;
}
