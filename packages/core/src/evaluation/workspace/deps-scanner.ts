/**
 * Lightweight scanner that extracts repo dependencies from eval YAML files
 * without performing full test/grader parsing.
 *
 * Used by `agentv workspace deps` to determine which repos CI needs to fetch
 * before running evals.
 *
 * How it works:
 * 1. Reads each eval YAML file and parses it
 * 2. Extracts `workspace.repos` at suite-level and per-test level
 * 3. Resolves external workspace file references (string -> file path)
 * 4. Deduplicates repos by (canonical repo identity, ref)
 * 5. Returns a flat list of unique repo dependencies
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { interpolateEnv } from '../interpolation.js';
import type { RepoConfig } from '../types.js';
import { parseYamlValue } from '../yaml-loader.js';
import { getRepoCheckoutRef } from './repo-checkout.js';
import { parseRepoConfig } from './repo-config-parser.js';
import { normalizeRepoIdentity, resolveRepoCloneUrl } from './repo-identity.js';

/** A single repo dependency discovered from eval files. */
export interface RepoDep {
  /** Git clone URL */
  readonly url: string;
  /** Checkout ref (branch, tag, SHA). undefined means HEAD. */
  readonly ref: string | undefined;
  /** Optional sparse-checkout paths. */
  readonly sparse: readonly string[] | undefined;
  /** Optional ancestor walk after checkout. */
  readonly ancestor: number | undefined;
  /** Eval files that reference this repo. */
  readonly usedBy: string[];
}

/** Full output of the deps scanner. */
export interface DepsScanResult {
  readonly repos: readonly RepoDep[];
  /** Files that failed to parse (non-fatal). */
  readonly errors: readonly { file: string; message: string }[];
}

/**
 * Scan eval YAML files and collect unique repo dependencies.
 * Non-YAML files and parse errors are collected in `errors` but don't stop scanning.
 */
export async function scanRepoDeps(evalFilePaths: readonly string[]): Promise<DepsScanResult> {
  const seen = new Map<string, RepoDep & { usedBy: string[] }>();
  const errors: { file: string; message: string }[] = [];

  for (const filePath of evalFilePaths) {
    try {
      const repos = await extractReposFromEvalFile(filePath);
      for (const repo of repos) {
        if (!repo.repo) continue;
        const checkoutRef = getRepoCheckoutRef(repo);
        const ref = checkoutRef === 'HEAD' ? undefined : checkoutRef;
        const key = `${normalizeRepoIdentity(repo.repo)}\0${ref ?? ''}`;
        const existing = seen.get(key);
        if (existing) {
          existing.usedBy.push(filePath);
        } else {
          seen.set(key, {
            url: resolveRepoCloneUrl(repo.repo),
            ref,
            sparse: repo.sparse,
            ancestor: repo.ancestor,
            usedBy: [filePath],
          });
        }
      }
    } catch (err) {
      errors.push({
        file: filePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { repos: [...seen.values()], errors };
}

// ---------------------------------------------------------------------------
// Internal helpers — lightweight YAML extraction, no full test parsing
// ---------------------------------------------------------------------------

async function extractReposFromEvalFile(filePath: string): Promise<RepoConfig[]> {
  const content = await readFile(filePath, 'utf8');
  const parsed = interpolateEnv(parseYamlValue(content), process.env);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const evalFileDir = path.dirname(path.resolve(filePath));

  const repos: RepoConfig[] = [];

  const suiteRepos = await extractReposFromWorkspaceRaw(obj.workspace, evalFileDir);
  repos.push(...suiteRepos);

  const tests = Array.isArray(obj.tests) ? obj.tests : [];
  for (const test of tests) {
    if (test && typeof test === 'object' && !Array.isArray(test)) {
      const testObj = test as Record<string, unknown>;
      const testRepos = await extractReposFromWorkspaceRaw(testObj.workspace, evalFileDir);
      repos.push(...testRepos);
    }
  }

  return repos;
}

/**
 * Extract repos from a raw workspace value.
 * Handles both inline objects and string references to external workspace files.
 */
async function extractReposFromWorkspaceRaw(
  raw: unknown,
  evalFileDir: string,
): Promise<RepoConfig[]> {
  if (typeof raw === 'string') {
    const workspaceFilePath = path.resolve(evalFileDir, raw);
    const content = await readFile(workspaceFilePath, 'utf8');
    const parsed = interpolateEnv(parseYamlValue(content), process.env);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return extractReposFromObject(parsed as Record<string, unknown>);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return extractReposFromObject(raw as Record<string, unknown>);
  }
  return [];
}

function extractReposFromObject(obj: Record<string, unknown>): RepoConfig[] {
  const rawRepos = Array.isArray(obj.repos) ? obj.repos : [];
  const result: RepoConfig[] = [];
  for (const r of rawRepos) {
    const parsed = parseRepoConfig(r);
    if (parsed?.repo) {
      result.push(parsed);
    }
  }
  return result;
}
