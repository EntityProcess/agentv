/**
 * Shared parser for eval workspace repo entries.
 *
 * Repo entries are provenance-only: `repo` names the canonical repository, and
 * `commit` pins the checkout. Acquisition details such as local mirrors, clone
 * depth, filters, and source type are resolved by the workspace harness, not
 * the eval YAML.
 */
import type { RepoConfig } from '../types.js';
import { isJsonObject } from '../types.js';

const SUPPORTED_REPO_FIELDS = new Set(['path', 'repo', 'commit', 'ancestor', 'sparse']);

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readStringArray(obj: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

export function parseRepoConfig(raw: unknown): RepoConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  if ('source' in obj) {
    throw new Error('workspace.repos[].source has been removed. Use workspace.repos[].repo.');
  }
  if ('checkout' in obj) {
    throw new Error(
      'workspace.repos[].checkout has been removed. Use top-level commit and ancestor.',
    );
  }
  if ('clone' in obj) {
    throw new Error('workspace.repos[].clone has been removed. Use top-level sparse if needed.');
  }
  if ('type' in obj) {
    throw new Error('workspace.repos[].type has been removed. Use workspace.repos[].repo.');
  }
  if ('resolve' in obj) {
    throw new Error(
      'workspace.repos[].resolve has been removed. Configure repo_resolvers instead.',
    );
  }
  if ('resolver' in obj) {
    throw new Error(
      'workspace.repos[].resolver has been removed. Configure repo_resolvers.repos patterns instead.',
    );
  }
  for (const key of Object.keys(obj)) {
    if (!SUPPORTED_REPO_FIELDS.has(key)) {
      throw new Error(
        `workspace.repos[].${key} is not supported. Supported fields: path, repo, commit, ancestor, sparse.`,
      );
    }
  }

  const repoPath = readString(obj, 'path');
  const repo = readString(obj, 'repo');
  const commit = readString(obj, 'commit');
  const ancestor = typeof obj.ancestor === 'number' ? obj.ancestor : undefined;
  const sparse = readStringArray(obj, 'sparse');

  if (!repoPath && !repo && !commit && ancestor === undefined && !sparse) {
    return undefined;
  }

  return {
    ...(repoPath !== undefined && { path: repoPath }),
    ...(repo !== undefined && { repo }),
    ...(commit !== undefined && { commit }),
    ...(ancestor !== undefined && { ancestor }),
    ...(sparse !== undefined && { sparse }),
  };
}
