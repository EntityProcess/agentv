import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import micromatch from 'micromatch';

import { getAgentvDataDir } from '../../paths.js';
import type { JsonObject, JsonValue, RepoConfig } from '../types.js';
import { isJsonObject } from '../types.js';
import { getRepoCheckoutRef } from './repo-checkout.js';
import { normalizeRepoIdentity, resolveRepoCloneUrl } from './repo-identity.js';

const RESOLVER_OUTPUT_LIMIT = 1024 * 1024;

export interface RepoResolverConfig {
  readonly name: string;
  readonly command: readonly string[];
  readonly repos?: readonly string[];
  readonly config: JsonObject;
  readonly cwd?: string;
  readonly sourcePath: string;
}

export interface RepoResolverRequest {
  readonly version: 1;
  readonly repo: string;
  readonly commit: string;
  readonly path: string;
  readonly sparse: readonly string[] | null;
  readonly ancestor: number | null;
  readonly cache_dir: string;
  readonly workspace_path: string;
  readonly config: JsonObject;
}

export interface RepoResolverGitSource {
  readonly type: 'git';
  readonly path: string;
  readonly origin?: string;
}

export interface RepoResolverHandledResult {
  readonly handled: true;
  readonly source: RepoResolverGitSource;
}

export interface RepoResolverUnhandledResult {
  readonly handled: false;
}

export type RepoResolverResult = RepoResolverHandledResult | RepoResolverUnhandledResult;

export type RepoResolverSelection =
  | { readonly kind: 'explicit'; readonly resolver: RepoResolverConfig }
  | { readonly kind: 'pattern'; readonly resolver: RepoResolverConfig }
  | { readonly kind: 'default'; readonly resolver: RepoResolverConfig };

export function parseRepoResolversFromConfig(
  rawConfig: Record<string, unknown>,
  sourcePath: string,
  cwd?: string,
): readonly RepoResolverConfig[] {
  const rawResolvers = rawConfig.repo_resolvers;
  if (rawResolvers === undefined) return [];
  if (!Array.isArray(rawResolvers)) {
    throw new Error(`repo_resolvers in ${sourcePath} must be an array.`);
  }

  return rawResolvers.map((rawResolver, index) =>
    parseRepoResolver(rawResolver, `repo_resolvers[${index}]`, sourcePath, cwd),
  );
}

export function validateRepoResolvers(resolvers: readonly RepoResolverConfig[]): void {
  const seenNames = new Set<string>();
  let defaultCount = 0;

  for (const resolver of resolvers) {
    if (seenNames.has(resolver.name)) {
      throw new Error(`Duplicate repo resolver name '${resolver.name}'.`);
    }
    seenNames.add(resolver.name);

    if (resolver.name === 'default') {
      defaultCount += 1;
      if (resolver.repos !== undefined) {
        throw new Error("Repo resolver named 'default' must not declare repos.");
      }
    }
  }

  if (defaultCount > 1) {
    throw new Error("Duplicate repo resolver named 'default'.");
  }
}

export function selectRepoResolver(
  repo: RepoConfig,
  resolvers: readonly RepoResolverConfig[],
): RepoResolverSelection | undefined {
  if (repo.resolver) {
    const resolver = resolvers.find((candidate) => candidate.name === repo.resolver);
    if (!resolver) {
      throw new Error(`workspace.repos[].resolver '${repo.resolver}' is not configured.`);
    }
    return { kind: 'explicit', resolver };
  }

  const patternResolver = resolvers.find(
    (resolver) => resolver.name !== 'default' && matchesRepoPatterns(repo, resolver.repos),
  );
  if (patternResolver) {
    return { kind: 'pattern', resolver: patternResolver };
  }

  const defaultResolver = resolvers.find((resolver) => resolver.name === 'default');
  return defaultResolver ? { kind: 'default', resolver: defaultResolver } : undefined;
}

export async function runRepoResolverCommand(
  resolver: RepoResolverConfig,
  repo: RepoConfig,
  workspacePath: string,
  timeoutMs: number,
): Promise<RepoResolverResult> {
  if (!repo.repo || !repo.path) {
    throw new Error('repo resolver requires workspace repo and path.');
  }

  const request = await buildRepoResolverRequest(resolver, repo, workspacePath);
  const stdout = await runResolverProcess(resolver, request, timeoutMs);
  return parseRepoResolverOutput(stdout, resolver.name);
}

function parseRepoResolver(
  rawResolver: unknown,
  location: string,
  sourcePath: string,
  cwd?: string,
): RepoResolverConfig {
  if (!rawResolver || typeof rawResolver !== 'object' || Array.isArray(rawResolver)) {
    throw new Error(`${location} in ${sourcePath} must be an object.`);
  }

  const resolver = rawResolver as Record<string, unknown>;
  const name = readNonEmptyString(resolver.name);
  if (!name) {
    throw new Error(`${location}.name in ${sourcePath} must be a non-empty string.`);
  }

  const command = readStringArray(resolver.command);
  if (!command) {
    throw new Error(`${location}.command in ${sourcePath} must be a non-empty string array.`);
  }

  const repos = readStringArray(resolver.repos);
  const config = resolver.config === undefined ? {} : resolver.config;
  if (!isJsonObject(config)) {
    throw new Error(`${location}.config in ${sourcePath} must be a JSON object.`);
  }

  return {
    name,
    command,
    config,
    sourcePath,
    ...(repos !== undefined && { repos }),
    ...(cwd !== undefined && { cwd }),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0 || !value.every((item) => typeof item === 'string')) return undefined;
  return value;
}

function matchesRepoPatterns(repo: RepoConfig, patterns: readonly string[] | undefined): boolean {
  if (!repo.repo || !patterns?.length) return false;

  const cloneUrl = resolveRepoCloneUrl(repo.repo);
  const identity = normalizeRepoIdentity(repo.repo);
  const candidates = new Set([
    repo.repo,
    stripGitSuffix(repo.repo),
    cloneUrl,
    stripGitSuffix(cloneUrl),
    identity,
  ]);

  return patterns.some((pattern) =>
    [...candidates].some((candidate) => micromatch.isMatch(candidate, pattern, { nocase: true })),
  );
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '');
}

async function buildRepoResolverRequest(
  resolver: RepoResolverConfig,
  repo: RepoConfig,
  workspacePath: string,
): Promise<RepoResolverRequest> {
  const cacheDir = path.join(
    getAgentvDataDir(),
    'cache',
    'repo-resolvers',
    cacheKeyForResolver(resolver.name),
  );
  await mkdir(cacheDir, { recursive: true });

  return {
    version: 1,
    repo: resolveRepoCloneUrl(repo.repo ?? ''),
    commit: getRepoCheckoutRef(repo),
    path: repo.path ?? '',
    sparse: repo.sparse ?? null,
    ancestor: repo.ancestor ?? null,
    cache_dir: cacheDir,
    workspace_path: workspacePath,
    config: resolver.config,
  };
}

function cacheKeyForResolver(name: string): string {
  const safePrefix = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resolver';
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 12);
  return `${safePrefix}-${hash}`;
}

function runResolverProcess(
  resolver: RepoResolverConfig,
  request: RepoResolverRequest,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = resolver.command;
    const child = spawn(command, args, {
      cwd: resolver.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (error) reject(error);
      else resolve(stdout);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });

    child.on('error', (error) => {
      finish(new Error(`Repo resolver '${resolver.name}' failed to start: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(new Error(`Repo resolver '${resolver.name}' timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        finish(
          new Error(
            `Repo resolver '${resolver.name}' exited with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}${output ? `:\n${output}` : ''}`,
          ),
        );
        return;
      }
      finish();
    });

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function appendLimited(current: string, chunk: Buffer): string {
  if (current.length >= RESOLVER_OUTPUT_LIMIT) return current;
  const next = current + chunk.toString();
  return next.length > RESOLVER_OUTPUT_LIMIT ? next.slice(-RESOLVER_OUTPUT_LIMIT) : next;
}

function parseRepoResolverOutput(stdout: string, resolverName: string): RepoResolverResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Repo resolver '${resolverName}' did not write valid JSON stdout: ${message}`);
  }

  if (!isJsonObject(parsed)) {
    throw new Error(`Repo resolver '${resolverName}' stdout must be a JSON object.`);
  }

  const output = parsed as Record<string, JsonValue>;
  if (output.handled === false) {
    return { handled: false };
  }
  if (output.handled !== true) {
    throw new Error(`Repo resolver '${resolverName}' stdout must set handled to true or false.`);
  }

  if (!isJsonObject(output.source)) {
    throw new Error(`Repo resolver '${resolverName}' handled the repo but did not return source.`);
  }

  const source = output.source as Record<string, JsonValue>;
  if (source.type !== 'git') {
    throw new Error(`Repo resolver '${resolverName}' returned unsupported source.type.`);
  }
  if (typeof source.path !== 'string' || source.path.trim().length === 0) {
    throw new Error(`Repo resolver '${resolverName}' source.path must be a non-empty string.`);
  }
  if (source.origin !== undefined && typeof source.origin !== 'string') {
    throw new Error(`Repo resolver '${resolverName}' source.origin must be a string when set.`);
  }

  return {
    handled: true,
    source: {
      type: 'git',
      path: source.path,
      ...(typeof source.origin === 'string' && { origin: source.origin }),
    },
  };
}
