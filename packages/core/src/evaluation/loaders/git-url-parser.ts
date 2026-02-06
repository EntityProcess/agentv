export interface GitUrlInfo {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly path: string;
  readonly cloneUrl: string;
}

// GitHub: https://github.com/{owner}/{repo}/blob/{ref}/{path}
// Capture everything after blob/ as refAndPath since ref can contain slashes
const GITHUB_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

// GitLab: https://gitlab.com/{owner/group}/{repo}/-/blob/{ref}/{path}
// Capture everything after blob/ as refAndPath since ref can contain slashes
const GITLAB_PATTERN = /^https:\/\/gitlab\.com\/(.+?)\/([^/]+)\/-\/blob\/(.+)$/;

// Bitbucket: https://bitbucket.org/{owner}/{repo}/src/{ref}/{path}
// Capture everything after src/ as refAndPath since ref can contain slashes
const BITBUCKET_PATTERN = /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/src\/(.+)$/;

/**
 * Parse a git host URL (GitHub, GitLab, Bitbucket) into components.
 * Returns null if the URL is not a recognized git host URL.
 */
export function parseGitUrl(url: string): GitUrlInfo | null {
  // GitHub
  const githubMatch = url.match(GITHUB_PATTERN);
  if (githubMatch) {
    const [, owner, repo, refAndPath] = githubMatch;
    // Handle branch names with slashes by finding the file path
    const { ref, path } = extractRefAndPath(refAndPath);
    return {
      host: 'github.com',
      owner,
      repo,
      ref,
      path,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  // GitLab
  const gitlabMatch = url.match(GITLAB_PATTERN);
  if (gitlabMatch) {
    const [, owner, repo, refAndPath] = gitlabMatch;
    const { ref, path } = extractRefAndPath(refAndPath);
    return {
      host: 'gitlab.com',
      owner,
      repo,
      ref,
      path,
      cloneUrl: `https://gitlab.com/${owner}/${repo}.git`,
    };
  }

  // Bitbucket
  const bitbucketMatch = url.match(BITBUCKET_PATTERN);
  if (bitbucketMatch) {
    const [, owner, repo, refAndPath] = bitbucketMatch;
    const { ref, path } = extractRefAndPath(refAndPath);
    return {
      host: 'bitbucket.org',
      owner,
      repo,
      ref,
      path,
      cloneUrl: `https://bitbucket.org/${owner}/${repo}.git`,
    };
  }

  return null;
}

/**
 * Extract ref and path from combined string.
 * Git host URLs combine ref and path: blob/{ref}/{path} or src/{ref}/{path}
 * When ref contains slashes (e.g., feature/foo), we need to find where ref ends and path begins.
 *
 * Strategy:
 * 1. Default: first segment is the ref, rest is the path
 * 2. If first segment is a known branch prefix (feature/, bugfix/, etc.), include the second segment in the ref
 *
 * This handles common branching conventions like feature/my-feature, bugfix/issue-123, etc.
 */
function extractRefAndPath(refAndPath: string): { ref: string; path: string } {
  const segments = refAndPath.split('/');

  if (segments.length <= 1) {
    return { ref: segments[0] || '', path: '' };
  }

  // Known branch prefixes that typically continue with a slash
  const branchPrefixes = [
    'feature',
    'bugfix',
    'hotfix',
    'release',
    'fix',
    'feat',
    'chore',
    'refactor',
    'docs',
    'test',
    'ci',
    'build',
    'perf',
    'style',
  ];

  const firstSegment = segments[0].toLowerCase();

  if (branchPrefixes.includes(firstSegment) && segments.length > 2) {
    // Branch like feature/my-feature, include first two segments in ref
    return {
      ref: `${segments[0]}/${segments[1]}`,
      path: segments.slice(2).join('/'),
    };
  }

  // Default: first segment is ref, rest is path
  return {
    ref: segments[0],
    path: segments.slice(1).join('/'),
  };
}
