#!/usr/bin/env bun
/**
 * Read-only guard for AgentV's public code repo vs private Beads repo split.
 *
 * Usage:
 *   bun scripts/check-beads-context.ts
 *   bun scripts/check-beads-context.ts --skip-bd
 *   bun scripts/check-beads-context.ts --deep
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const expectedCodeRepo = 'EntityProcess/agentv';
const expectedBeadsRepo = 'EntityProcess/agentv-beads';
const expectedBeadsRemote = `git+https://github.com/${expectedBeadsRepo}.git`;
const metadataPath = '.beads/metadata.json';
const configPath = '.beads/config.yaml';

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

const decoder = new TextDecoder();
const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: bun scripts/check-beads-context.ts [--skip-bd] [--deep]

Checks that AgentV's code checkout uses ${expectedCodeRepo} while Beads
coordination uses ${expectedBeadsRepo}. The default mode is read-only and runs
bd context plus bd bootstrap --dry-run when bd is installed.

Options:
  --skip-bd  Only inspect git and committed .beads config files.
  --deep     Also run bd federation status and bd dolt remote list in readonly mode.`);
  process.exit(0);
}

const skipBd = args.has('--skip-bd');
const deep = args.has('--deep');
const findings: Finding[] = [];

function record(level: Level, message: string, detail?: string, fix?: string): void {
  findings.push({ level, message, detail, fix });
}

function run(command: string, commandArgs: readonly string[]): CommandResult {
  try {
    const result = Bun.spawnSync([command, ...commandArgs], {
      cwd: root,
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
    record('WARN', `${label} failed`, combinedOutput(result));
    return undefined;
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    record('WARN', `${label} returned non-JSON output`, combinedOutput(result, String(error)));
    return undefined;
  }
}

function combinedOutput(result: CommandResult, extra?: string): string {
  return [result.stdout, result.stderr, extra].filter(Boolean).join('\n');
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

function sameRepo(left: string | undefined, right: string | undefined): boolean {
  const leftSlug = repoSlug(left);
  const rightSlug = repoSlug(right);
  return Boolean(leftSlug && rightSlug && leftSlug === rightSlug);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readFederationRemote(): string | undefined {
  if (!existsSync(resolve(root, configPath))) {
    record(
      'ERROR',
      `${configPath} is missing`,
      undefined,
      `Restore ${configPath} with federation.remote: "${expectedBeadsRemote}"`,
    );
    return undefined;
  }

  const raw = readFileSync(resolve(root, configPath), 'utf8');
  let parsed: Record<string, unknown> | null;

  try {
    const value = parseYaml(raw) as unknown;
    parsed =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
  } catch (error) {
    record('ERROR', `${configPath} is not valid YAML`, String(error));
    return undefined;
  }

  const nested = parsed?.federation;
  return (
    stringValue(parsed?.['federation.remote']) ??
    (nested && typeof nested === 'object'
      ? stringValue((nested as Record<string, unknown>).remote)
      : undefined)
  );
}

function checkTrackedBeadsFiles(): void {
  const configTracked = run('git', ['ls-files', '--error-unmatch', configPath]);
  if (configTracked.exitCode === 0) {
    record('OK', `${configPath} is tracked`);
  } else {
    record('ERROR', `${configPath} is not tracked`);
  }

  const metadataTracked = run('git', ['ls-files', '--error-unmatch', metadataPath]);
  if (metadataTracked.exitCode === 0) {
    record(
      'ERROR',
      `${metadataPath} is tracked but must be checkout-local`,
      undefined,
      `Run: git rm --cached ${metadataPath}`,
    );
  } else {
    record('OK', `${metadataPath} is not tracked`);
  }

  const metadataIgnored = run('git', ['check-ignore', '-q', metadataPath]);
  if (metadataIgnored.exitCode === 0) {
    record('OK', `${metadataPath} is ignored for future bootstraps`);
  } else {
    record(
      'ERROR',
      `${metadataPath} is not ignored`,
      undefined,
      `Add ${metadataPath.replace('.beads/', '')} to .beads/.gitignore`,
    );
  }
}

function checkRepoSplit(federationRemote: string | undefined): void {
  const gitOrigin = run('git', ['remote', 'get-url', 'origin']);
  const gitOriginUrl = gitOrigin.exitCode === 0 ? gitOrigin.stdout : undefined;
  const gitOriginRepo = repoSlug(gitOriginUrl);
  const federationRepo = repoSlug(federationRemote);

  if (!gitOriginUrl) {
    record('WARN', 'git origin is not configured', combinedOutput(gitOrigin));
  } else if (gitOriginRepo === expectedBeadsRepo) {
    record(
      'ERROR',
      'git origin points at the Beads coordination repo',
      gitOriginUrl,
      `Set the code repo origin back to https://github.com/${expectedCodeRepo}.git`,
    );
  } else {
    record('OK', `git origin is ${gitOriginRepo ?? gitOriginUrl}`);
  }

  if (!federationRemote) {
    record(
      'ERROR',
      'Beads federation.remote is missing',
      undefined,
      `Set ${configPath} to federation.remote: "${expectedBeadsRemote}"`,
    );
  } else if (federationRepo !== expectedBeadsRepo) {
    record(
      'ERROR',
      'Beads federation.remote does not point at agentv-beads',
      federationRemote,
      `Set ${configPath} to federation.remote: "${expectedBeadsRemote}"`,
    );
  } else {
    record('OK', `Beads federation.remote is ${federationRepo}`);
  }

  if (gitOriginRepo && federationRepo && gitOriginRepo === federationRepo) {
    record(
      'ERROR',
      'git origin and Beads federation.remote point at the same repository',
      `git origin: ${gitOriginUrl}\nfederation.remote: ${federationRemote}`,
      `AgentV code stays in ${expectedCodeRepo}; Beads data stays in ${expectedBeadsRepo}.`,
    );
  } else if (gitOriginRepo && federationRepo) {
    record('OK', 'code repo and Beads repo are split');
  }
}

function checkBdContext(federationRemote: string | undefined): void {
  const context = parseJsonOutput<{
    readonly beads_dir?: string;
    readonly cwd_repo_root?: string;
    readonly is_worktree?: boolean;
    readonly project_id?: string;
    readonly repo_root?: string;
  }>(run('bd', ['--readonly', 'context', '--json']), 'bd context --json');

  if (context?.project_id) {
    record('OK', `bd context project_id is ${context.project_id}`);
  }

  if (context?.is_worktree && context.beads_dir) {
    record('OK', `bd worktree context uses beads_dir ${context.beads_dir}`);
  }

  const bootstrap = parseJsonOutput<{
    readonly action?: string;
    readonly reason?: string;
    readonly sync_remote?: string;
  }>(
    run('bd', ['--readonly', 'bootstrap', '--dry-run', '--json']),
    'bd bootstrap --dry-run --json',
  );

  const bootstrapRemote = bootstrap?.sync_remote;
  if (!bootstrapRemote) {
    record('WARN', 'bd bootstrap dry-run did not report a sync_remote', bootstrap?.reason);
    return;
  }

  if (federationRemote && !sameRepo(bootstrapRemote, federationRemote)) {
    record(
      'ERROR',
      'bd bootstrap would sync from a remote that differs from federation.remote',
      `bootstrap sync_remote: ${bootstrapRemote}\nfederation.remote: ${federationRemote}\nreason: ${
        bootstrap?.reason ?? 'unknown'
      }`,
      `Do not run bd bootstrap or bd dolt push from this checkout until the Dolt remote is pointed at ${expectedBeadsRemote}.`,
    );
    return;
  }

  if (repoSlug(bootstrapRemote) === expectedCodeRepo) {
    record(
      'ERROR',
      'bd bootstrap would sync Beads data from the public code repo',
      bootstrapRemote,
      `Expected Beads data remote: ${expectedBeadsRemote}`,
    );
    return;
  }

  record(
    'OK',
    `bd bootstrap dry-run sync_remote is ${repoSlug(bootstrapRemote) ?? bootstrapRemote}`,
  );
}

function checkDeepBdState(): void {
  const federationStatus = run('bd', ['--readonly', 'federation', 'status']);
  const federationText = combinedOutput(federationStatus);

  if (federationStatus.exitCode !== 0) {
    const looksLikeIdentityMismatch = /identity mismatch|project[_ -]?id|metadata/i.test(
      federationText,
    );
    record(
      looksLikeIdentityMismatch ? 'ERROR' : 'WARN',
      'bd federation status failed',
      federationText,
      looksLikeIdentityMismatch
        ? `Re-point Dolt origin to ${expectedBeadsRemote}, remove copied ${metadataPath}, then run bd bootstrap --dry-run before bd bootstrap.`
        : undefined,
    );
  } else if (/identity mismatch|project[_ -]?id mismatch/i.test(federationText)) {
    record(
      'ERROR',
      'bd federation status reports project identity drift',
      federationText,
      `Re-point Dolt origin to ${expectedBeadsRemote}, remove copied ${metadataPath}, then run bd bootstrap --dry-run before bd bootstrap.`,
    );
  } else {
    record('OK', 'bd federation status completed');
  }

  const doltRemoteList = run('bd', ['--readonly', 'dolt', 'remote', 'list']);
  const doltText = combinedOutput(doltRemoteList);
  if (doltRemoteList.exitCode !== 0) {
    record('WARN', 'bd dolt remote list failed', doltText);
  } else if (doltText.includes(expectedCodeRepo) && !doltText.includes(expectedBeadsRepo)) {
    record(
      'ERROR',
      'Dolt origin appears to point at the public code repo',
      doltText,
      `Run: bd dolt remote remove origin\nThen: bd dolt remote add origin ${expectedBeadsRemote}`,
    );
  } else {
    record('OK', 'bd dolt remote list does not expose the code repo as the only remote');
  }
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

const federationRemote = readFederationRemote();

checkTrackedBeadsFiles();
checkRepoSplit(federationRemote);

if (skipBd) {
  record('WARN', 'skipped bd diagnostics');
} else {
  checkBdContext(federationRemote);
}

if (deep) {
  checkDeepBdState();
}

printFindings();

process.exit(findings.some((finding) => finding.level === 'ERROR') ? 1 : 0);
