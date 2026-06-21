#!/usr/bin/env bun
/**
 * Read-only guard for AgentV's public code repo vs private Beads repo split.
 *
 * Usage:
 *   bun scripts/check-beads-context.ts
 *   bun scripts/check-beads-context.ts --skip-bd
 *   bun scripts/check-beads-context.ts --fixture
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const expectedCodeRepo = 'EntityProcess/agentv';
const expectedBeadsRepo = 'EntityProcess/agentv-beads';
const expectedBeadsRemote = `git+https://github.com/${expectedBeadsRepo}.git`;
const expectedDatabase = 'av';
const expectedProjectId = 'a7aea826-0087-45fc-93f5-9084e9924e8b';

const gitignorePath = '.beads/.gitignore';
const configExamplePath = '.beads/config.yaml.example';
const configPath = '.beads/config.yaml';
const metadataPath = '.beads/metadata.json';

type Level = 'OK' | 'WARN' | 'ERROR';

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Finding {
  readonly level: Level;
  readonly message: string;
  readonly detail?: string;
  readonly fix?: string;
}

interface BeadsMetadata {
  readonly backend?: string;
  readonly database?: string;
  readonly dolt_database?: string;
  readonly dolt_mode?: string;
  readonly project_id?: string;
}

interface BdContext {
  readonly database?: string;
  readonly project_id?: string;
  readonly repo_root?: string;
  readonly beads_dir?: string;
}

interface BootstrapPlan {
  readonly action?: string;
  readonly database?: string;
  readonly reason?: string;
  readonly sync_remote?: string;
}

const decoder = new TextDecoder();
const args = new Set(process.argv.slice(2));
const findings: Finding[] = [];

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: bun scripts/check-beads-context.ts [--skip-bd] [--fixture]

Checks that AgentV's code checkout uses ${expectedCodeRepo} while Beads
coordination uses ${expectedBeadsRepo}.

Default mode checks the current checkout and asks bd for read-only context plus
bootstrap dry-run output. Copy ${configExamplePath} to ${configPath} before
running default mode in a new checkout.

Options:
  --skip-bd  Only inspect tracked files and local config files.
  --fixture  Build a disposable git repo, copy the Beads template to local
             config, and verify bd fresh-bootstrap identity and sync remote.`);
  process.exit(0);
}

const skipBd = args.has('--skip-bd');
const runFixture = args.has('--fixture');

function record(level: Level, message: string, detail?: string, fix?: string): void {
  findings.push({ level, message, detail, fix });
}

function run(command: string, commandArgs: readonly string[], cwd = root): CommandResult {
  try {
    const result = Bun.spawnSync([command, ...commandArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout).trim(),
      stderr: decoder.decode(result.stderr).trim(),
    };
  } catch (error) {
    return {
      exitCode: 127,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseJsonOutput<T>(result: CommandResult, label: string): T | undefined {
  if (result.exitCode !== 0) {
    record('ERROR', `${label} failed`, combinedOutput(result));
    return undefined;
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    record('ERROR', `${label} returned non-JSON output`, combinedOutput(result, String(error)));
    return undefined;
  }
}

function combinedOutput(result: CommandResult, extra?: string): string {
  return [result.stdout, result.stderr, extra].filter(Boolean).join('\n');
}

function readJsonFile<T>(relativePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as T;
  } catch (error) {
    record('ERROR', `${relativePath} is not valid JSON`, String(error));
    return undefined;
  }
}

function readYamlFile(relativePath: string): Record<string, unknown> | undefined {
  try {
    const value = parseYaml(readFileSync(resolve(root, relativePath), 'utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    record('ERROR', `${relativePath} must contain a YAML object`);
    return undefined;
  } catch (error) {
    record('ERROR', `${relativePath} is not valid YAML`, String(error));
    return undefined;
  }
}

function configValue(config: Record<string, unknown>, key: 'federation.remote' | 'sync.remote') {
  const direct = stringValue(config[key]);
  if (direct) return direct;

  const [section, field] = key.split('.');
  const nested = config[section];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return stringValue((nested as Record<string, unknown>)[field]);
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function repoSlug(remote: string | undefined): string | undefined {
  if (!remote) return undefined;

  const clean = remote
    .trim()
    .replace(/^git\+/, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  const sshMatch = clean.match(/^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+)$/);
  if (sshMatch?.groups) return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`;

  const httpsMatch = clean.match(/^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/);
  if (httpsMatch?.groups) return `${httpsMatch.groups.owner}/${httpsMatch.groups.repo}`;

  return undefined;
}

function checkTracked(path: string): boolean {
  const result = run('git', ['ls-files', '--error-unmatch', path]);
  if (result.exitCode === 0) {
    record('OK', `${path} is tracked`);
    return true;
  }

  record('ERROR', `${path} is not tracked`);
  return false;
}

function checkNotTracked(path: string): void {
  const result = run('git', ['ls-files', '--error-unmatch', path]);
  if (result.exitCode === 0) {
    record('ERROR', `${path} is tracked but must stay checkout-local`);
  } else {
    record('OK', `${path} is checkout-local`);
  }
}

function checkIgnored(path: string): void {
  const result = run('git', ['check-ignore', '-q', path]);
  if (result.exitCode === 0) {
    record('OK', `${path} is ignored`);
  } else {
    record(
      'WARN',
      `${path} is not ignored`,
      undefined,
      `Add ${path.replace('.beads/', '')} to ${gitignorePath}.`,
    );
  }
}

function checkNotIgnored(path: string): void {
  const result = run('git', ['check-ignore', '-q', path]);
  if (result.exitCode === 0) {
    record(
      'ERROR',
      `${path} is ignored but must remain versioned`,
      undefined,
      `Remove ${path.replace('.beads/', '')} from ${gitignorePath}.`,
    );
  } else {
    record('OK', `${path} is not ignored`);
  }
}

function checkMetadata(): void {
  if (!checkTracked(metadataPath)) return;
  checkNotIgnored(metadataPath);

  const metadata = readJsonFile<BeadsMetadata>(metadataPath);
  if (!metadata) return;

  if (
    metadata.backend === 'dolt' &&
    metadata.database === 'dolt' &&
    metadata.dolt_mode === 'embedded' &&
    metadata.dolt_database === expectedDatabase &&
    metadata.project_id === expectedProjectId
  ) {
    record('OK', `${metadataPath} preserves database ${expectedDatabase}`);
    return;
  }

  record(
    'ERROR',
    `${metadataPath} does not match AgentV Beads identity`,
    JSON.stringify(metadata, null, 2),
    `Run: git restore -- ${metadataPath}`,
  );
}

function checkConfigFile(relativePath: string, required: boolean): void {
  if (!existsSync(resolve(root, relativePath))) {
    record(
      required ? 'ERROR' : 'WARN',
      `${relativePath} is missing`,
      undefined,
      required ? undefined : `Run: cp ${configExamplePath} ${configPath}`,
    );
    return;
  }

  const config = readYamlFile(relativePath);
  if (!config) return;

  for (const key of ['sync.remote', 'federation.remote'] as const) {
    const remote = configValue(config, key);
    const slug = repoSlug(remote);
    if (slug === expectedBeadsRepo) {
      record('OK', `${relativePath} ${key} points at ${expectedBeadsRepo}`);
    } else {
      record(
        'ERROR',
        `${relativePath} ${key} must point at ${expectedBeadsRepo}`,
        remote,
        `Set ${key}: "${expectedBeadsRemote}"`,
      );
    }
  }
}

function checkConfig(): void {
  checkTracked(gitignorePath);
  checkTracked(configExamplePath);
  checkConfigFile(configExamplePath, true);

  checkNotTracked(configPath);
  checkIgnored(configPath);
  checkConfigFile(configPath, false);
}

function checkRepoSplit(): void {
  const origin = run('git', ['remote', 'get-url', 'origin']);
  if (origin.exitCode !== 0) {
    record('WARN', 'git origin is not configured', combinedOutput(origin));
    return;
  }

  const originSlug = repoSlug(origin.stdout);
  if (originSlug === expectedCodeRepo) {
    record('OK', `git origin is ${expectedCodeRepo}`);
  } else if (originSlug === expectedBeadsRepo) {
    record(
      'ERROR',
      'git origin points at the Beads coordination repo',
      origin.stdout,
      `Set origin back to https://github.com/${expectedCodeRepo}.git`,
    );
  } else {
    record('WARN', `git origin is ${originSlug ?? origin.stdout}`);
  }
}

function checkBdCurrent(): void {
  const context = parseJsonOutput<BdContext>(
    run('bd', ['--readonly', 'context', '--json']),
    'bd context --json',
  );
  if (context) checkContextIdentity(context, 'current bd context');

  if (context?.repo_root && resolve(context.repo_root) !== root) {
    record(
      'WARN',
      'bd context is using a Beads directory outside this checkout',
      `repo_root: ${context.repo_root}\nbeads_dir: ${context.beads_dir ?? 'unknown'}`,
      `Use --fixture to verify this branch template. If operating on the shared Beads directory, copy ${configExamplePath} to that checkout's ${configPath}.`,
    );
    return;
  }

  const bootstrap = parseJsonOutput<BootstrapPlan>(
    run('bd', ['--readonly', 'bootstrap', '--dry-run', '--json']),
    'bd bootstrap --dry-run --json',
  );
  if (bootstrap) checkBootstrapPlan(bootstrap, 'current bootstrap dry-run');
}

function checkFixture(): void {
  const fixture = mkdtempSync(join(tmpdir(), 'agentv-beads-context-'));

  try {
    run('git', ['init', '-q', fixture]);
    run('git', [
      '-C',
      fixture,
      'remote',
      'add',
      'origin',
      `https://github.com/${expectedCodeRepo}.git`,
    ]);
    mkdirSync(join(fixture, '.beads'), { recursive: true });
    chmodSync(join(fixture, '.beads'), 0o700);
    copyFileSync(resolve(root, gitignorePath), join(fixture, gitignorePath));
    copyFileSync(resolve(root, metadataPath), join(fixture, metadataPath));
    copyFileSync(resolve(root, configExamplePath), join(fixture, configPath));

    const context = parseJsonOutput<BdContext>(
      run('bd', ['-C', fixture, '--readonly', 'context', '--json']),
      'fixture bd context --json',
    );
    if (context) checkContextIdentity(context, 'fixture bd context');

    const bootstrap = parseJsonOutput<BootstrapPlan>(
      run('bd', ['-C', fixture, '--readonly', 'bootstrap', '--dry-run', '--json']),
      'fixture bd bootstrap --dry-run --json',
    );
    if (bootstrap) checkBootstrapPlan(bootstrap, 'fixture bootstrap dry-run');
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

function checkContextIdentity(context: BdContext, label: string): void {
  if (context.database === expectedDatabase && context.project_id === expectedProjectId) {
    record('OK', `${label} uses database ${expectedDatabase} and expected project ID`);
    return;
  }

  record(
    'ERROR',
    `${label} does not use AgentV Beads identity`,
    JSON.stringify(context, null, 2),
    `Restore ${metadataPath}, copy ${configExamplePath} to ${configPath}, then run bd bootstrap --dry-run before any push.`,
  );
}

function checkBootstrapPlan(plan: BootstrapPlan, label: string): void {
  const syncSlug = repoSlug(plan.sync_remote);
  const databaseOk = plan.database === expectedDatabase;
  const remoteOk = syncSlug === expectedBeadsRepo;

  if (databaseOk && remoteOk) {
    record('OK', `${label} uses ${expectedDatabase} from ${expectedBeadsRepo}`);
    return;
  }

  record(
    'ERROR',
    `${label} would not bootstrap from AgentV Beads`,
    JSON.stringify(plan, null, 2),
    `Copy ${configExamplePath} to ${configPath} and keep sync.remote at "${expectedBeadsRemote}".`,
  );
}

function printFindings(): void {
  console.log('AgentV Beads context preflight\n');

  for (const finding of findings) {
    console.log(`${finding.level}: ${finding.message}`);
    if (finding.detail) console.log(indent(finding.detail));
    if (finding.fix) console.log(indent(`Fix: ${finding.fix}`));
  }

  const errorCount = findings.filter((finding) => finding.level === 'ERROR').length;
  const warningCount = findings.filter((finding) => finding.level === 'WARN').length;
  console.log(`\n${errorCount} error(s), ${warningCount} warning(s)`);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

checkMetadata();
checkConfig();
checkRepoSplit();

if (!skipBd && !runFixture) {
  checkBdCurrent();
}

if (runFixture) {
  checkFixture();
}

printFindings();

process.exit(findings.some((finding) => finding.level === 'ERROR') ? 1 : 0);
