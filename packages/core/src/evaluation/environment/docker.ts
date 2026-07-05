import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  DockerEnvironmentRecipe,
  EnvironmentSetupConfig,
} from '../loaders/environment-recipe.js';
import type { TargetRuntimeConfig } from '../providers/sandbox-runner.js';
import {
  type CommandExecutor,
  DefaultCommandExecutor,
  DockerWorkspaceProvider,
} from '../workspace/docker-workspace.js';

export type DockerEnvironmentSetupStatus = 'skipped' | 'success' | 'failed';

export interface DockerEnvironmentSetupResult {
  readonly type: 'docker';
  readonly image: string;
  readonly workdir: string;
  readonly status: DockerEnvironmentSetupStatus;
  readonly command?: readonly string[];
  readonly cwd?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly targetRuntime: TargetRuntimeConfig;
}

export class DockerEnvironmentSetupError extends Error {
  readonly result: DockerEnvironmentSetupResult;

  constructor(message: string, result: DockerEnvironmentSetupResult) {
    super(message);
    this.name = 'DockerEnvironmentSetupError';
    this.result = result;
  }
}

function dockerImageTag(recipe: DockerEnvironmentRecipe): string {
  const hash = createHash('sha256')
    .update(recipe.context ?? '')
    .update('\0')
    .update(recipe.dockerfile ?? '')
    .digest('hex')
    .slice(0, 16);
  return `agentv-environment:${hash}`;
}

function setupPayload(recipe: DockerEnvironmentRecipe) {
  return {
    environment: {
      type: 'docker',
      workdir: recipe.workdir,
      ...(recipe.image ? { image: recipe.image } : {}),
      ...(recipe.context ? { context: recipe.context } : {}),
      ...(recipe.dockerfile ? { dockerfile: recipe.dockerfile } : {}),
    },
  };
}

function setupCwd(setup: EnvironmentSetupConfig, recipe: DockerEnvironmentRecipe): string {
  if (!setup.cwd) {
    return recipe.workdir;
  }
  return path.posix.isAbsolute(setup.cwd)
    ? setup.cwd
    : path.posix.resolve(recipe.workdir, setup.cwd);
}

function dockerRuntimeForRecipe(
  recipe: DockerEnvironmentRecipe,
  image: string,
): TargetRuntimeConfig {
  const setup = recipe.setup;
  const payload = JSON.stringify(setupPayload({ ...recipe, image }), null, 2);
  const tempDir = path.resolve(tmpdir());
  const recipeMounts = (recipe.mounts ?? []).map((mount) => ({
    source: mount.source,
    target: mount.target,
    access: mount.read_only === true ? 'ro' : (mount.access ?? 'rw'),
  }));
  const mounts = recipeMounts.some((mount) => mount.target === tempDir)
    ? recipeMounts
    : [...recipeMounts, { source: tempDir, target: tempDir, access: 'rw' }];
  return {
    mode: 'sandbox',
    engine: 'docker',
    image,
    workdir: recipe.workdir,
    host_cwd: recipe.sourceDir,
    env: {
      ...(recipe.env ?? {}),
      AGENTV_ENVIRONMENT_WORKDIR: recipe.workdir,
    },
    ...(recipe.secrets !== undefined ? { secrets: recipe.secrets } : {}),
    mounts,
    ...(recipe.resources?.memory !== undefined ? { memory: recipe.resources.memory } : {}),
    ...(recipe.resources?.cpus !== undefined ? { cpus: recipe.resources.cpus } : {}),
    ...(setup !== undefined
      ? {
          setup: [
            {
              command: setup.command,
              cwd: setupCwd(setup, recipe),
              stdin: payload,
              ...(setup.timeoutMs !== undefined ? { timeout_ms: setup.timeoutMs } : {}),
            },
          ],
        }
      : {}),
  };
}

function formatDockerFailure(
  action: string,
  result: { stderr: string; stdout: string; exitCode: number },
) {
  const details = result.stderr.trim() || result.stdout.trim();
  return details
    ? `docker ${action} failed (exit ${result.exitCode}): ${details}`
    : `docker ${action} failed (exit ${result.exitCode})`;
}

export async function prepareDockerEnvironment(
  recipe: DockerEnvironmentRecipe,
  executor: CommandExecutor = new DefaultCommandExecutor(),
): Promise<DockerEnvironmentSetupResult> {
  const image = recipe.context ? (recipe.image ?? dockerImageTag(recipe)) : recipe.image;
  if (!image) {
    throw new Error('Docker environment requires image when context is not set.');
  }

  const docker = new DockerWorkspaceProvider(
    {
      image,
      ...(recipe.resources?.memory !== undefined ? { memory: recipe.resources.memory } : {}),
      ...(recipe.resources?.cpus !== undefined ? { cpus: recipe.resources.cpus } : {}),
    },
    executor,
  );

  if (!(await docker.isDockerAvailable())) {
    throw new Error(
      'Docker environment configured but Docker CLI is not available. Install Docker and ensure it is running.',
    );
  }

  if (recipe.context) {
    const argv = ['docker', 'build', '-t', image];
    if (recipe.dockerfile) {
      argv.push('-f', recipe.dockerfile);
    }
    argv.push(recipe.context);
    const result = await executor.exec(argv, { timeoutMs: 30 * 60 * 1000 });
    if (result.exitCode !== 0) {
      const failure: DockerEnvironmentSetupResult = {
        type: 'docker',
        image,
        workdir: recipe.workdir,
        status: 'failed',
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        targetRuntime: dockerRuntimeForRecipe(recipe, image),
      };
      throw new DockerEnvironmentSetupError(formatDockerFailure('build', result), failure);
    }
  } else {
    await docker.pullImage();
  }

  const runtime = dockerRuntimeForRecipe(recipe, image);
  return {
    type: 'docker',
    image,
    workdir: recipe.workdir,
    status: recipe.setup ? 'success' : 'skipped',
    ...(recipe.setup?.command !== undefined ? { command: recipe.setup.command } : {}),
    ...(recipe.setup !== undefined ? { cwd: setupCwd(recipe.setup, recipe) } : {}),
    targetRuntime: runtime,
  };
}
