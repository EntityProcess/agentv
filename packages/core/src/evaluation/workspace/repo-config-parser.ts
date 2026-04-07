/**
 * Shared parsers for repo configuration objects (source, checkout, clone).
 *
 * Used by both the full YAML parser (yaml-parser.ts) and the lightweight
 * deps scanner (deps-scanner.ts) to avoid duplicating parsing logic.
 */
import type { RepoCheckout, RepoClone, RepoConfig, RepoSource } from '../types.js';
import { isJsonObject } from '../types.js';

export function parseRepoSource(raw: unknown): RepoSource | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'git' && typeof obj.url === 'string') {
    return { type: 'git', url: obj.url };
  }
  if (obj.type === 'local' && typeof obj.path === 'string') {
    return { type: 'local', path: obj.path };
  }
  return undefined;
}

export function parseRepoCheckout(raw: unknown): RepoCheckout | undefined {
  if (!isJsonObject(raw)) return undefined;
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

export function parseRepoClone(raw: unknown): RepoClone | undefined {
  if (!isJsonObject(raw)) return undefined;
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

export function parseRepoConfig(raw: unknown): RepoConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const repoPath = typeof obj.path === 'string' ? obj.path : undefined;
  const source = parseRepoSource(obj.source);
  if (!repoPath || !source) return undefined;
  const checkout = parseRepoCheckout(obj.checkout);
  const clone = parseRepoClone(obj.clone);
  return {
    path: repoPath,
    source,
    ...(checkout !== undefined && { checkout }),
    ...(clone !== undefined && { clone }),
  };
}
