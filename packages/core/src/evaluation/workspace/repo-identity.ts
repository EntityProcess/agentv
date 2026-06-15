/**
 * Helpers for comparing repo identities independently from acquisition.
 *
 * Eval YAML accepts either a full clone URL or GitHub `org/name` shorthand.
 * The materializer uses the resolved clone URL for git commands and the
 * canonical key for cache paths, project-origin matching, and pool fingerprints.
 */

const GITHUB_SHORTHAND_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function resolveRepoCloneUrl(repo: string): string {
  const trimmed = repo.trim();
  if (GITHUB_SHORTHAND_RE.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  return trimmed;
}

export function normalizeRepoIdentity(repo: string): string {
  const cloneUrl = resolveRepoCloneUrl(repo);

  const sshMatch = /^git@([^:]+):(.+)$/.exec(cloneUrl);
  if (sshMatch) {
    return normalizeHostPath(sshMatch[1], sshMatch[2]);
  }

  try {
    const parsed = new URL(cloneUrl);
    if (parsed.protocol === 'ssh:' && parsed.username === 'git') {
      return normalizeHostPath(parsed.hostname, parsed.pathname);
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return normalizeHostPath(parsed.hostname, parsed.pathname);
    }
    if (parsed.protocol === 'file:') {
      return `file://${stripGitSuffix(decodeURIComponent(parsed.pathname)).replace(/\/+$/, '')}`;
    }
  } catch {
    // Local paths are not part of the public schema, but keeping a stable
    // fallback lets tests and explicit file://-like values fingerprint safely.
  }

  return stripGitSuffix(cloneUrl).replace(/\/+$/, '');
}

function normalizeHostPath(host: string, rawPath: string): string {
  const normalizedPath = stripGitSuffix(rawPath.replace(/^\/+/, '').replace(/\/+$/, ''));
  const normalized =
    host.toLowerCase() === 'github.com' ? normalizedPath.toLowerCase() : normalizedPath;
  return `${host.toLowerCase()}/${normalized}`;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '');
}
