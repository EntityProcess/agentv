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

import { interpolateEnv } from '../interpolation.js';
import type { RepoCheckout, RepoClone, RepoSource } from '../types.js';
import { parseRepoCheckout, parseRepoClone, parseRepoSource } from './repo-config-parser.js';

/** A single git repo dependency discovered from eval files. */
export interface RepoDep {
  /** Git clone URL */
  readonly url: string;
  /** Checkout ref (branch, tag, SHA). undefined means HEAD. */
  readonly ref: string | undefined;
  /** Clone options (depth, filter, sparse) — first-wins on dedup collision */
  readonly clone: RepoClone | undefined;
  /** Checkout options (resolve, ancestor) — first-wins on dedup collision */
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

/** Normalize a git URL for dedup: strip trailing .git and lowercase the host. */
function normalizeGitUrl(url: string): string {
  let normalized = url.replace(/\.git$/, '');
  // Lowercase the host portion of https:// URLs
  try {
    const parsed = new URL(normalized);
    parsed.hostname = parsed.hostname.toLowerCase();
    normalized = parsed.toString().replace(/\/$/, '');
  } catch {
    // Not a valid URL (e.g., SSH shorthand) — use as-is
  }
  return normalized;
}

/**
 * Scan eval YAML files and collect unique git repo dependencies.
 * Non-YAML files and parse errors are collected in `errors` but don't stop scanning.
 *
 * Dedup strategy: repos are keyed by (normalized URL, ref). On collision,
 * clone/checkout options from the first occurrence win — this is intentional
 * since the manifest is advisory (CI can override clone options).
 */
export async function scanRepoDeps(evalFilePaths: readonly string[]): Promise<DepsScanResult> {
  const seen = new Map<string, RepoDep & { usedBy: string[] }>();
  const errors: { file: string; message: string }[] = [];

  for (const filePath of evalFilePaths) {
    try {
      const repos = await extractReposFromEvalFile(filePath);
      for (const repo of repos) {
        if (!repo.source || repo.source.type !== 'git') continue;
        const ref = repo.checkout?.ref;
        const key = `${normalizeGitUrl(repo.source.url)}\0${ref ?? ''}`;
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
  source: RepoSource;
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
async function extractReposFromWorkspaceRaw(raw: unknown, evalFileDir: string): Promise<RawRepo[]> {
  if (typeof raw === 'string') {
    // External workspace file reference
    const workspaceFilePath = path.resolve(evalFileDir, raw);
    const content = await readFile(workspaceFilePath, 'utf8');
    const parsed = interpolateEnv(parse(content), process.env);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return extractReposFromObject(parsed as Record<string, unknown>);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return extractReposFromObject(raw as Record<string, unknown>);
  }
  return [];
}

function extractReposFromObject(obj: Record<string, unknown>): RawRepo[] {
  const rawRepos = Array.isArray(obj.repos) ? obj.repos : [];
  const result: RawRepo[] = [];
  for (const r of rawRepos) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const repo = r as Record<string, unknown>;
    const source = parseRepoSource(repo.source);
    if (!source) continue;
    result.push({
      source,
      checkout: parseRepoCheckout(repo.checkout),
      clone: parseRepoClone(repo.clone),
    });
  }
  return result;
}
