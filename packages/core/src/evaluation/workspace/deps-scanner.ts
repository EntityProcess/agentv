/**
 * Lightweight scanner that extracts git repo dependencies from eval YAML files
 * without performing full test/grader parsing.
 *
 * Used by `agentv workspace deps` to determine which repos CI needs to clone
 * before running evals.
 *
 * How it works:
 * 1. Reads each eval YAML file and parses it
 * 2. Extracts `workspace.repos` at suite-level and per-test level
 * 3. Resolves external workspace file references (string → file path)
 * 4. Deduplicates git repos by (url, ref)
 * 5. Returns a flat list of unique repo dependencies
 *
 * To extend: add support for new workspace source types by adding a branch
 * in `extractReposFromWorkspaceRaw()`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import type { RepoCheckout, RepoClone } from '../types.js';
import { interpolateEnv } from '../interpolation.js';

/** A single git repo dependency discovered from eval files. */
export interface RepoDep {
  /** Git clone URL */
  readonly url: string;
  /** Checkout ref (branch, tag, SHA). undefined means HEAD. */
  readonly ref: string | undefined;
  /** Clone options (depth, filter, sparse) — merged from first occurrence */
  readonly clone: RepoClone | undefined;
  /** Checkout options (resolve, ancestor) — from first occurrence */
  readonly checkout: Omit<RepoCheckout, 'ref'> | undefined;
  /** Eval files that reference this repo */
  readonly usedBy: string[];
}

/** Full output of the deps scanner. */
export interface DepsScanResult {
  readonly repos: readonly RepoDep[];
  /** Files that failed to parse (non-fatal) */
  readonly errors: readonly { file: string; message: string }[];
}

/**
 * Scan eval YAML files and collect unique git repo dependencies.
 * Non-YAML files and parse errors are collected in `errors` but don't stop scanning.
 */
export async function scanRepoDeps(evalFilePaths: readonly string[]): Promise<DepsScanResult> {
  const seen = new Map<string, RepoDep & { usedBy: string[] }>();
  const errors: { file: string; message: string }[] = [];

  for (const filePath of evalFilePaths) {
    try {
      const repos = await extractReposFromEvalFile(filePath);
      for (const repo of repos) {
        if (repo.source.type !== 'git') continue;
        const ref = repo.checkout?.ref;
        const key = `${repo.source.url}\0${ref ?? ''}`;
        const existing = seen.get(key);
        if (existing) {
          existing.usedBy.push(filePath);
        } else {
          const { ref: _ref, ...checkoutRest } = repo.checkout ?? {};
          const hasCheckout = Object.keys(checkoutRest).length > 0;
          seen.set(key, {
            url: repo.source.url,
            ref,
            clone: repo.clone,
            checkout: hasCheckout ? checkoutRest : undefined,
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

interface RawRepo {
  source: { type: 'git'; url: string } | { type: 'local'; path: string };
  checkout?: RepoCheckout;
  clone?: RepoClone;
}

async function extractReposFromEvalFile(filePath: string): Promise<RawRepo[]> {
  const content = await readFile(filePath, 'utf8');
  const parsed = interpolateEnv(parse(content), process.env);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const evalFileDir = path.dirname(path.resolve(filePath));

  const repos: RawRepo[] = [];

  // Suite-level workspace
  const suiteRepos = await extractReposFromWorkspaceRaw(obj.workspace, evalFileDir);
  repos.push(...suiteRepos);

  // Per-test workspace
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
): Promise<RawRepo[]> {
  if (typeof raw === 'string') {
    // External workspace file reference
    const workspaceFilePath = path.resolve(evalFileDir, raw);
    const content = await readFile(workspaceFilePath, 'utf8');
    const parsed = interpolateEnv(parse(content), process.env);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const wsDir = path.dirname(workspaceFilePath);
    return extractReposFromObject(parsed as Record<string, unknown>, wsDir);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return extractReposFromObject(raw as Record<string, unknown>, evalFileDir);
  }
  return [];
}

function extractReposFromObject(obj: Record<string, unknown>, _baseDir: string): RawRepo[] {
  const rawRepos = Array.isArray(obj.repos) ? obj.repos : [];
  const result: RawRepo[] = [];
  for (const r of rawRepos) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const repo = r as Record<string, unknown>;
    const source = parseSourceRaw(repo.source);
    if (!source) continue;
    result.push({
      source,
      checkout: parseCheckoutRaw(repo.checkout),
      clone: parseCloneRaw(repo.clone),
    });
  }
  return result;
}

function parseSourceRaw(
  raw: unknown,
): { type: 'git'; url: string } | { type: 'local'; path: string } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'git' && typeof obj.url === 'string') {
    return { type: 'git', url: obj.url };
  }
  if (obj.type === 'local' && typeof obj.path === 'string') {
    return { type: 'local', path: obj.path };
  }
  return undefined;
}

function parseCheckoutRaw(raw: unknown): RepoCheckout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const ref = typeof obj.ref === 'string' ? obj.ref : undefined;
  const resolve = obj.resolve === 'remote' || obj.resolve === 'local' ? obj.resolve : undefined;
  const ancestor = typeof obj.ancestor === 'number' ? obj.ancestor : undefined;
  if (!ref && !resolve && ancestor === undefined) return undefined;
  return {
    ...(ref !== undefined && { ref }),
    ...(resolve !== undefined && { resolve }),
    ...(ancestor !== undefined && { ancestor }),
  };
}

function parseCloneRaw(raw: unknown): RepoClone | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const depth = typeof obj.depth === 'number' ? obj.depth : undefined;
  const filter = typeof obj.filter === 'string' ? obj.filter : undefined;
  const sparse = Array.isArray(obj.sparse)
    ? obj.sparse.filter((s): s is string => typeof s === 'string')
    : undefined;
  if (depth === undefined && !filter && !sparse) return undefined;
  return {
    ...(depth !== undefined && { depth }),
    ...(filter !== undefined && { filter }),
    ...(sparse !== undefined && { sparse }),
  };
}
