/**
 * Shared parser for eval workspace repo entries.
 *
 * Repo entries are provenance-only: `repo` names the canonical repository,
 * `commit` pins the checkout, and `base_commit` is a SWE-bench-friendly alias
 * for that pin. Acquisition details such as local mirrors, clone depth, filters,
 * and source type are resolved by the workspace harness, not the eval YAML.
 */
import type { RepoConfig } from '../types.js';
import { isJsonObject } from '../types.js';

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
      'workspace.repos[].checkout has been removed. Use top-level commit, base_commit, and ancestor.',
    );
  }
  if ('clone' in obj) {
    throw new Error('workspace.repos[].clone has been removed. Use top-level sparse if needed.');
  }

  const repoPath = readString(obj, 'path');
  const repo = readString(obj, 'repo');
  const commit = readString(obj, 'commit');
  const baseCommit = readString(obj, 'base_commit');
  const ancestor = typeof obj.ancestor === 'number' ? obj.ancestor : undefined;
  const sparse = readStringArray(obj, 'sparse');

  if (commit !== undefined && baseCommit !== undefined && commit !== baseCommit) {
    throw new Error('workspace.repos[].commit and workspace.repos[].base_commit must match.');
  }

  if (!repoPath && !repo && !commit && !baseCommit && ancestor === undefined && !sparse) {
    return undefined;
  }

  return {
    ...(repoPath !== undefined && { path: repoPath }),
    ...(repo !== undefined && { repo }),
    ...(commit !== undefined && { commit }),
    ...(baseCommit !== undefined && { base_commit: baseCommit }),
    ...(ancestor !== undefined && { ancestor }),
    ...(sparse !== undefined && { sparse }),
  };
}
