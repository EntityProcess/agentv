import type { RepoConfig } from '../types.js';

export interface RepoCheckoutTarget {
  readonly path?: string;
  readonly ref: string;
}

export function getRepoCheckoutRef(repo: RepoConfig | undefined): string {
  return repo?.commit ?? 'HEAD';
}

export function getRepoCheckoutTargets(
  repos: readonly RepoConfig[] | undefined,
): RepoCheckoutTarget[] {
  if (!repos) return [];
  return repos
    .filter((repo) => repo.commit)
    .map((repo) => ({
      path: repo.path,
      ref: getRepoCheckoutRef(repo),
    }));
}
