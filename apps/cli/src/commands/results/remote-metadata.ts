/**
 * Mutable metadata overlays for remote result runs.
 *
 * Remote run artifacts under `runs/**` on the results branch are treated as
 * immutable fetched payloads. Editable fields, starting with tags, live in a
 * small sidecar tree under `metadata/runs/**` inside the configured results repo
 * checkout. That keeps local edits pushable by normal Git sync without rewriting
 * the fetched run directory.
 *
 * To add another mutable field: create a sibling helper that maps the remote
 * run manifest to the same metadata run directory, keep the on-disk keys
 * snake_case, and compare the working tree file against the upstream Git ref
 * so Dashboard can show pending local edits.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { RUN_TAGS_FILENAME, normalizeTags } from './run-tags.js';

const RESULTS_RUNS_DIR = 'runs';
const REMOTE_METADATA_RUNS_DIR = path.join('metadata', 'runs');

interface TagsFile {
  readonly tags: string[];
  readonly updatedAt?: string;
}

interface RemoteRunMetadataPaths {
  readonly runRelativePath: string;
  readonly artifactTagsPath: string;
  readonly artifactTagsGitPath: string;
  readonly overlayTagsPath: string;
  readonly overlayTagsGitPath: string;
}

interface RemoteRunTagsContext {
  readonly paths: RemoteRunMetadataPaths;
  readonly artifactTags: TagsFile | undefined;
  readonly baseOverlayTags: TagsFile | undefined;
  readonly localOverlayTags: TagsFile | undefined;
}

export interface RemoteRunTagState {
  readonly tags: string[];
  readonly remoteTags: string[];
  readonly pendingTags?: string[];
  readonly dirty: boolean;
  readonly updatedAt?: string;
  readonly metadataPath: string;
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('GIT_') && key !== 'GIT_SSH_COMMAND')) {
      env[key] = value;
    }
  }
  return env;
}

function runGit(repoDir: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repoDir,
    encoding: 'utf8',
    env: cleanGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryRunGit(repoDir: string, args: readonly string[]): string | undefined {
  try {
    return runGit(repoDir, args);
  } catch {
    return undefined;
  }
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function readTagsFile(filePath: string): TagsFile | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return parseTagsFile(readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function readTagsFromGit(
  repoDir: string,
  ref: string | undefined,
  gitPath: string,
): TagsFile | undefined {
  if (!ref) return undefined;
  const content = tryRunGit(repoDir, ['show', `${ref}:${gitPath}`]);
  if (content === undefined) return undefined;
  try {
    return parseTagsFile(content);
  } catch {
    return undefined;
  }
}

function parseTagsFile(content: string): TagsFile | undefined {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.tags)) return undefined;
  const tags = record.tags.filter((tag): tag is string => typeof tag === 'string');
  return {
    tags,
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : undefined,
  };
}

function equalTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, index) => tag === b[index]);
}

function resolveComparisonRef(repoDir: string): string | undefined {
  const upstream = tryRunGit(repoDir, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (upstream) return upstream;
  return tryRunGit(repoDir, ['rev-parse', '--verify', 'HEAD']) ? 'HEAD' : undefined;
}

function resolveRemoteRunMetadataPaths(
  repoDir: string,
  manifestPath: string,
): RemoteRunMetadataPaths {
  const runsRoot = path.resolve(repoDir, RESULTS_RUNS_DIR);
  const manifestDir = path.resolve(path.dirname(manifestPath));
  const runRelativePath = path.relative(runsRoot, manifestDir);
  if (
    runRelativePath.length === 0 ||
    runRelativePath.startsWith('..') ||
    path.isAbsolute(runRelativePath)
  ) {
    throw new Error(
      `Remote run manifest is outside the results repo runs directory: ${manifestPath}`,
    );
  }

  const overlayTagsPath = path.join(
    repoDir,
    REMOTE_METADATA_RUNS_DIR,
    runRelativePath,
    RUN_TAGS_FILENAME,
  );
  const artifactTagsPath = path.join(runsRoot, runRelativePath, RUN_TAGS_FILENAME);

  return {
    runRelativePath,
    artifactTagsPath,
    artifactTagsGitPath: toGitPath(path.relative(repoDir, artifactTagsPath)),
    overlayTagsPath,
    overlayTagsGitPath: toGitPath(path.relative(repoDir, overlayTagsPath)),
  };
}

function readRemoteRunTagsContext(repoDir: string, manifestPath: string): RemoteRunTagsContext {
  const paths = resolveRemoteRunMetadataPaths(repoDir, manifestPath);
  const comparisonRef = resolveComparisonRef(repoDir);
  const artifactTags =
    readTagsFile(paths.artifactTagsPath) ??
    readTagsFromGit(repoDir, comparisonRef, paths.artifactTagsGitPath);
  const baseOverlayTags = readTagsFromGit(repoDir, comparisonRef, paths.overlayTagsGitPath);
  const localOverlayTags = readTagsFile(paths.overlayTagsPath);

  return {
    paths,
    artifactTags,
    baseOverlayTags,
    localOverlayTags,
  };
}

function toRemoteRunTagState(context: RemoteRunTagsContext): RemoteRunTagState {
  const remoteTags = context.baseOverlayTags?.tags ?? context.artifactTags?.tags ?? [];
  const effectiveTags = context.localOverlayTags?.tags ?? remoteTags;
  const dirty = !equalTags(effectiveTags, remoteTags);

  return {
    tags: effectiveTags,
    remoteTags,
    ...(dirty && { pendingTags: effectiveTags }),
    dirty,
    updatedAt:
      context.localOverlayTags?.updatedAt ??
      context.baseOverlayTags?.updatedAt ??
      context.artifactTags?.updatedAt,
    metadataPath: context.paths.overlayTagsPath,
  };
}

export function assertWritableResultsRepo(repoDir: string): void {
  if (!existsSync(repoDir)) {
    throw new Error('Writable results repo is not configured for remote metadata');
  }
  const insideWorkTree = tryRunGit(repoDir, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree !== 'true') {
    throw new Error(`Configured results repo is not a writable git checkout: ${repoDir}`);
  }
}

export function isResultsRepoWorktreeDirty(repoDir: string): boolean {
  if (!existsSync(repoDir)) return false;
  const status = tryRunGit(repoDir, ['status', '--porcelain']);
  return status !== undefined && status.trim().length > 0;
}

export function readRemoteRunTags(repoDir: string, manifestPath: string): RemoteRunTagState {
  const context = readRemoteRunTagsContext(repoDir, manifestPath);
  return toRemoteRunTagState(context);
}

export function writeRemoteRunTags(
  repoDir: string,
  manifestPath: string,
  tags: readonly string[],
): RemoteRunTagState {
  assertWritableResultsRepo(repoDir);

  const cleaned = normalizeTags(tags);
  const context = readRemoteRunTagsContext(repoDir, manifestPath);
  const remoteTags = context.baseOverlayTags?.tags ?? context.artifactTags?.tags ?? [];

  if (equalTags(cleaned, remoteTags) && context.baseOverlayTags === undefined) {
    rmSync(context.paths.overlayTagsPath, { force: true });
    return readRemoteRunTags(repoDir, manifestPath);
  }

  const entry = {
    tags: cleaned,
    updated_at: new Date().toISOString(),
  };
  mkdirSync(path.dirname(context.paths.overlayTagsPath), { recursive: true });
  writeFileSync(context.paths.overlayTagsPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  return readRemoteRunTags(repoDir, manifestPath);
}

export function deleteRemoteRunTags(repoDir: string, manifestPath: string): RemoteRunTagState {
  return writeRemoteRunTags(repoDir, manifestPath, []);
}
