import type { RepoCheckout, RepoConfig } from '../types.js';

export interface RepoCheckoutTarget {
  readonly path?: string;
  readonly ref: string;
}

export function getRepoCheckoutRef(checkout: RepoCheckout | undefined): string {
  return checkout?.base_commit ?? checkout?.ref ?? 'HEAD';
}

export function getRepoCheckoutTargets(
  repos: readonly RepoConfig[] | undefined,
): RepoCheckoutTarget[] {
  if (!repos) return [];
  return repos
    .filter((repo) => repo.checkout?.base_commit || repo.checkout?.ref)
    .map((repo) => ({
      path: repo.path,
      ref: getRepoCheckoutRef(repo.checkout),
    }));
}
