#!/usr/bin/env bun
/**
 * Create example eval repositories and wire each one to a dedicated AgentV
 * eval-results repository.
 *
 * Usage:
 *   bun scripts/deploy-example-results-repos.ts scripts/deploy-example-results-repos.example.yaml
 *   bun scripts/deploy-example-results-repos.ts config.yaml --dry-run
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { stringify as stringifyYaml } from 'yaml';

import { parseYamlValue } from '../packages/core/src/evaluation/yaml-loader.js';

const execFileAsync = promisify(execFile);

type Visibility = 'private' | 'public' | 'internal';

interface DeploymentDefaults {
  readonly clone_root: string;
  readonly results_clone_root: string;
  readonly visibility: Visibility;
  readonly auto_push: boolean;
  readonly branch_prefix?: string;
  readonly create_readmes: boolean;
}

interface RepoPairConfig {
  readonly eval_repo: string;
  readonly eval_results_repo: string;
  readonly eval_description?: string;
  readonly eval_results_description?: string;
  readonly visibility?: Visibility;
  readonly results_path?: string;
  readonly auto_push?: boolean;
  readonly branch_prefix?: string;
}

interface DeploymentConfig {
  readonly defaults: DeploymentDefaults;
  readonly repositories: readonly RepoPairConfig[];
}

interface CliOptions {
  readonly configPath: string;
  readonly dryRun: boolean;
  readonly push: boolean;
}

const DEFAULTS: DeploymentDefaults = {
  clone_root: '~/agentv-example-repos',
  results_clone_root: '~/data/agentv-results',
  visibility: 'private',
  auto_push: true,
  branch_prefix: 'eval-results',
  create_readmes: true,
};

function printHelp(): void {
  console.log(`Usage: bun scripts/deploy-example-results-repos.ts <config.yaml> [--dry-run] [--no-push]

Creates or verifies GitHub eval/eval-results repo pairs, then commits AgentV
remote-results configuration into each eval repo.

Config shape:
  defaults:
    clone_root: ~/agentv-example-repos
    results_clone_root: ~/data/agentv-results
    visibility: private
    auto_push: true
  repositories:
    - eval_repo: Owner/example-evals
      eval_results_repo: Owner/example-eval-results
`);
}

function parseArgs(argv: readonly string[]): CliOptions {
  let configPath = '';
  let dryRun = false;
  let push = true;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-push') {
      push = false;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (configPath) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    configPath = arg;
  }

  if (!configPath) {
    throw new Error('Missing config path. Pass --help for usage.');
  }

  return { configPath, dryRun, push };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandHome(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

function repoSlug(repo: string): string {
  return repo
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .toLowerCase();
}

function repoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

function assertRepoName(value: string, field: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`${field} must be GitHub owner/name, got: ${value}`);
  }
}

function parseVisibility(value: unknown, fallback: Visibility): Visibility {
  if (value === undefined) return fallback;
  if (value === 'private' || value === 'public' || value === 'internal') return value;
  throw new Error(`visibility must be private, public, or internal; got: ${String(value)}`);
}

function parseBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw new Error(`${field} must be a boolean`);
}

function parseString(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`${field} must be a non-empty string`);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`${field} must be a non-empty string when provided`);
}

function loadDeploymentConfig(configPath: string): DeploymentConfig {
  const raw = readFileSync(configPath, 'utf8');
  const parsed = parseYamlValue(raw);
  if (!isObject(parsed)) {
    throw new Error(`${configPath} must contain a YAML mapping`);
  }

  const rawDefaults = isObject(parsed.defaults) ? parsed.defaults : {};
  const defaults: DeploymentDefaults = {
    clone_root: parseString(rawDefaults.clone_root, DEFAULTS.clone_root, 'defaults.clone_root'),
    results_clone_root: parseString(
      rawDefaults.results_clone_root,
      DEFAULTS.results_clone_root,
      'defaults.results_clone_root',
    ),
    visibility: parseVisibility(rawDefaults.visibility, DEFAULTS.visibility),
    auto_push: parseBoolean(rawDefaults.auto_push, DEFAULTS.auto_push, 'defaults.auto_push'),
    branch_prefix: optionalString(rawDefaults.branch_prefix, 'defaults.branch_prefix'),
    create_readmes: parseBoolean(
      rawDefaults.create_readmes,
      DEFAULTS.create_readmes,
      'defaults.create_readmes',
    ),
  };

  if (!Array.isArray(parsed.repositories) || parsed.repositories.length === 0) {
    throw new Error('repositories must be a non-empty array');
  }

  const repositories = parsed.repositories.map((entry, index): RepoPairConfig => {
    if (!isObject(entry)) {
      throw new Error(`repositories[${index}] must be a mapping`);
    }
    const evalRepo = parseString(entry.eval_repo, '', `repositories[${index}].eval_repo`);
    const evalResultsRepo = parseString(
      entry.eval_results_repo,
      '',
      `repositories[${index}].eval_results_repo`,
    );
    assertRepoName(evalRepo, `repositories[${index}].eval_repo`);
    assertRepoName(evalResultsRepo, `repositories[${index}].eval_results_repo`);

    return {
      eval_repo: evalRepo,
      eval_results_repo: evalResultsRepo,
      eval_description: optionalString(
        entry.eval_description,
        `repositories[${index}].eval_description`,
      ),
      eval_results_description: optionalString(
        entry.eval_results_description,
        `repositories[${index}].eval_results_description`,
      ),
      visibility: parseVisibility(entry.visibility, defaults.visibility),
      results_path: optionalString(entry.results_path, `repositories[${index}].results_path`),
      auto_push: parseBoolean(
        entry.auto_push,
        defaults.auto_push,
        `repositories[${index}].auto_push`,
      ),
      branch_prefix: optionalString(entry.branch_prefix, `repositories[${index}].branch_prefix`),
    };
  });

  return { defaults, repositories };
}

async function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly dryRun?: boolean; readonly check?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  const printable = [command, ...args].join(' ');
  if (options.dryRun) {
    console.log(`[dry-run] ${options.cwd ? `(${options.cwd}) ` : ''}${printable}`);
    return { stdout: '', stderr: '' };
  }

  try {
    return await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (options.check === false && error && typeof error === 'object') {
      const execError = error as { stdout?: string; stderr?: string };
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
      };
    }
    throw error;
  }
}

async function repoExists(repo: string): Promise<boolean> {
  const result = await run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], {
    check: false,
  });
  return result.stdout.trim().length > 0;
}

async function ensureGitHubRepo(params: {
  readonly repo: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly dryRun: boolean;
}): Promise<void> {
  if (!params.dryRun && (await repoExists(params.repo))) {
    console.log(`Repo exists: ${params.repo}`);
    return;
  }

  const visibilityFlag = `--${params.visibility}`;
  await run(
    'gh',
    [
      'repo',
      'create',
      params.repo,
      visibilityFlag,
      '--description',
      params.description,
      '--clone=false',
    ],
    { dryRun: params.dryRun },
  );
  console.log(`Created repo: ${params.repo}`);
}

async function cloneOrUpdateRepo(params: {
  readonly repo: string;
  readonly cloneRoot: string;
  readonly dryRun: boolean;
}): Promise<string> {
  const repoDir = path.join(expandHome(params.cloneRoot), repoSlug(params.repo));
  if (!existsSync(repoDir)) {
    mkdirSync(path.dirname(repoDir), { recursive: true });
    await run('gh', ['repo', 'clone', params.repo, repoDir], { dryRun: params.dryRun });
    return repoDir;
  }

  if (!existsSync(path.join(repoDir, '.git'))) {
    throw new Error(`Clone path exists but is not a git repo: ${repoDir}`);
  }

  await run('git', ['fetch', 'origin', '--prune'], { cwd: repoDir, dryRun: params.dryRun });
  await run('git', ['pull', '--ff-only'], { cwd: repoDir, dryRun: params.dryRun, check: false });
  return repoDir;
}

async function assertClean(repoDir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repoDir });
  if (stdout.trim().length > 0) {
    throw new Error(`Refusing to edit dirty checkout: ${repoDir}`);
  }
}

function writeFileIfChanged(filePath: string, content: string, dryRun: boolean): boolean {
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
  if (current === content) {
    return false;
  }

  if (dryRun) {
    console.log(`[dry-run] write ${filePath}`);
    return true;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return true;
}

async function commitAndMaybePush(params: {
  readonly repoDir: string;
  readonly message: string;
  readonly push: boolean;
  readonly dryRun: boolean;
}): Promise<void> {
  await run('git', ['add', '--all'], { cwd: params.repoDir, dryRun: params.dryRun });
  const { stdout } = await run('git', ['status', '--porcelain'], {
    cwd: params.repoDir,
    dryRun: params.dryRun,
  });
  if (!params.dryRun && stdout.trim().length === 0) {
    console.log(`No changes in ${params.repoDir}`);
    return;
  }

  let branch = 'main';
  if (!params.dryRun) {
    const branchResult = await run('git', ['branch', '--show-current'], { cwd: params.repoDir });
    branch = branchResult.stdout.trim() || 'main';
    if (!branchResult.stdout.trim()) {
      await run('git', ['checkout', '-B', branch], { cwd: params.repoDir });
    }
  }

  await run('git', ['commit', '-m', params.message], {
    cwd: params.repoDir,
    dryRun: params.dryRun,
  });

  if (params.push) {
    await run('git', ['push', '-u', 'origin', branch], {
      cwd: params.repoDir,
      dryRun: params.dryRun,
    });
  }
}

function readYamlObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const parsed = parseYamlValue(readFileSync(filePath, 'utf8'));
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (!isObject(parsed)) {
    throw new Error(`${filePath} must contain a YAML mapping`);
  }
  return parsed;
}

function configureEvalRepo(params: {
  readonly repoDir: string;
  readonly evalRepo: string;
  readonly resultsRepo: string;
  readonly resultsPath: string;
  readonly autoPush: boolean;
  readonly branchPrefix?: string;
  readonly createReadmes: boolean;
  readonly dryRun: boolean;
}): boolean {
  let changed = false;

  if (params.createReadmes) {
    const readme = `# ${params.evalRepo}

Example AgentV eval repository.

This repo is configured to push evaluation results to \`${params.resultsRepo}\`.
`;
    changed =
      writeFileIfChanged(path.join(params.repoDir, 'README.md'), readme, params.dryRun) || changed;
  }

  const configPath = path.join(params.repoDir, '.agentv', 'config.yaml');
  const config = readYamlObject(configPath);
  config.results = {
    repo: {
      remote: repoUrl(params.resultsRepo),
      path: params.resultsPath,
    },
    sync: {
      auto_push: params.autoPush,
    },
    ...(params.branchPrefix ? { branch_prefix: params.branchPrefix } : {}),
  };

  const nextConfig = stringifyYaml(config, { lineWidth: 100 });
  changed = writeFileIfChanged(configPath, nextConfig, params.dryRun) || changed;

  return changed;
}

function initializeResultsRepo(params: {
  readonly repoDir: string;
  readonly resultsRepo: string;
  readonly createReadmes: boolean;
  readonly dryRun: boolean;
}): boolean {
  let changed = false;

  if (params.createReadmes) {
    const readme = `# ${params.resultsRepo}

Shared AgentV evaluation results repository.

AgentV stores run artifacts under \`.agentv/results/\` and syncs them through normal git fetch/push operations.
`;
    changed =
      writeFileIfChanged(path.join(params.repoDir, 'README.md'), readme, params.dryRun) || changed;
  }

  changed =
    writeFileIfChanged(
      path.join(params.repoDir, '.agentv', 'results', 'default', '.gitkeep'),
      '',
      params.dryRun,
    ) || changed;

  return changed;
}

async function deployPair(
  defaults: DeploymentDefaults,
  pair: RepoPairConfig,
  options: Pick<CliOptions, 'dryRun' | 'push'>,
): Promise<void> {
  const visibility = pair.visibility ?? defaults.visibility;
  const autoPush = pair.auto_push ?? defaults.auto_push;
  const branchPrefix = pair.branch_prefix ?? defaults.branch_prefix;
  const resultsPath =
    pair.results_path ?? path.join(defaults.results_clone_root, repoSlug(pair.eval_results_repo));

  console.log(`\n== ${pair.eval_repo} -> ${pair.eval_results_repo} ==`);

  await ensureGitHubRepo({
    repo: pair.eval_repo,
    description: pair.eval_description ?? 'Example AgentV eval definitions',
    visibility,
    dryRun: options.dryRun,
  });
  await ensureGitHubRepo({
    repo: pair.eval_results_repo,
    description: pair.eval_results_description ?? 'Shared AgentV eval results',
    visibility,
    dryRun: options.dryRun,
  });

  const evalRepoDir = await cloneOrUpdateRepo({
    repo: pair.eval_repo,
    cloneRoot: defaults.clone_root,
    dryRun: options.dryRun,
  });
  const resultsRepoDir = await cloneOrUpdateRepo({
    repo: pair.eval_results_repo,
    cloneRoot: defaults.clone_root,
    dryRun: options.dryRun,
  });

  await assertClean(evalRepoDir, options.dryRun);
  await assertClean(resultsRepoDir, options.dryRun);

  initializeResultsRepo({
    repoDir: resultsRepoDir,
    resultsRepo: pair.eval_results_repo,
    createReadmes: defaults.create_readmes,
    dryRun: options.dryRun,
  });
  await commitAndMaybePush({
    repoDir: resultsRepoDir,
    message: 'chore: initialize AgentV results repo',
    push: options.push,
    dryRun: options.dryRun,
  });

  configureEvalRepo({
    repoDir: evalRepoDir,
    evalRepo: pair.eval_repo,
    resultsRepo: pair.eval_results_repo,
    resultsPath,
    autoPush,
    branchPrefix,
    createReadmes: defaults.create_readmes,
    dryRun: options.dryRun,
  });
  await commitAndMaybePush({
    repoDir: evalRepoDir,
    message: 'chore: configure AgentV remote results',
    push: options.push,
    dryRun: options.dryRun,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(options.configPath);
  const config = loadDeploymentConfig(configPath);

  for (const pair of config.repositories) {
    await deployPair(config.defaults, pair, options);
  }

  console.log('\nDeployment complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
