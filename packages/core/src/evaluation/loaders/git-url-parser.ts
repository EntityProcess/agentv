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
const GITLAB_PATTERN = /^https:\/\/gitlab\.com\/(.+?)\/([^/]+)\/-\/blob\/([^/]+)\/(.+)$/;

// Bitbucket: https://bitbucket.org/{owner}/{repo}/src/{ref}/{path}
const BITBUCKET_PATTERN = /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/src\/([^/]+)\/(.+)$/;

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
    const [, owner, repo, ref, path] = gitlabMatch;
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
    const [, owner, repo, ref, path] = bitbucketMatch;
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
 * GitHub URLs combine ref and path: blob/{ref}/{path}
 * When ref contains slashes (e.g., feature/foo), we need to find where ref ends and path begins.
 *
 * Strategy:
 * 1. Find the file (segment with extension or known filename)
 * 2. Determine if the first segment is a "branch prefix" that typically continues with slashes
 * 3. If it's a branch prefix (feature/, bugfix/, etc.), include the next segment in ref
 * 4. Otherwise, first segment is the ref, rest before file is the path
 */
function extractRefAndPath(refAndPath: string): { ref: string; path: string } {
  const segments = refAndPath.split('/');

  // Find the index of the first segment that looks like a file
  let fileIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (looksLikeFile(segments[i])) {
      fileIndex = i;
      break;
    }
  }

  // If no file found, assume last segment is the file
  if (fileIndex === -1) {
    fileIndex = segments.length - 1;
  }

  // If only one segment before file, that's the ref
  if (fileIndex <= 1) {
    return {
      ref: segments.slice(0, fileIndex).join('/') || segments[0],
      path: segments.slice(fileIndex).join('/'),
    };
  }

  // Check if first segment is a branch prefix that commonly has slashes
  const firstSegment = segments[0].toLowerCase();
  const branchPrefixes = ['feature', 'bugfix', 'hotfix', 'release', 'fix', 'feat', 'chore', 'refactor', 'docs', 'test', 'ci', 'build', 'perf', 'style'];

  if (branchPrefixes.includes(firstSegment)) {
    // This is likely a branch like feature/my-feature, include next segment in ref
    // Continue including segments until we hit something that looks like a path
    let refEndIndex = 2; // At minimum include prefix/name

    // Check if there are more segments that look like branch name continuation
    for (let i = 2; i < fileIndex; i++) {
      // Stop if this segment looks like a typical directory name
      if (looksLikePathSegment(segments[i])) {
        break;
      }
      refEndIndex = i + 1;
    }

    return {
      ref: segments.slice(0, refEndIndex).join('/'),
      path: segments.slice(refEndIndex).join('/'),
    };
  }

  // Default: first segment is ref, rest is path
  return {
    ref: segments[0],
    path: segments.slice(1).join('/'),
  };
}

/**
 * Check if a segment looks like a typical path/directory segment.
 * These are common directory names that indicate we've moved past the ref.
 */
function looksLikePathSegment(segment: string): boolean {
  const pathPatterns = [
    'src',
    'lib',
    'test',
    'tests',
    'spec',
    'docs',
    'doc',
    'examples',
    'example',
    'bin',
    'scripts',
    'config',
    'configs',
    'public',
    'private',
    'internal',
    'pkg',
    'packages',
    'apps',
    'cmd',
    'api',
    'web',
    'app',
    'assets',
    'static',
    'resources',
    'dist',
    'build',
    'out',
    'output',
    'target',
    'vendor',
    'node_modules',
    'components',
    'utils',
    'helpers',
    'services',
    'models',
    'views',
    'controllers',
    'middleware',
    'routes',
    'handlers',
    'core',
    'common',
    'shared',
    'types',
    'interfaces',
    'schemas',
    'migrations',
    'fixtures',
    'mocks',
    '__tests__',
    '__mocks__',
    '.github',
    '.vscode',
    '.circleci',
  ];
  return pathPatterns.includes(segment.toLowerCase());
}

/**
 * Check if a path segment looks like a filename.
 */
function looksLikeFile(segment: string): boolean {
  // Has a file extension (must contain at least one letter to avoid matching version numbers like v1.0.0)
  if (/\.[a-zA-Z][a-zA-Z0-9]*$/.test(segment)) {
    return true;
  }
  // Known extensionless files
  const knownFiles = ['Makefile', 'Dockerfile', 'LICENSE', 'README', 'CHANGELOG', 'Gemfile', 'Rakefile'];
  return knownFiles.includes(segment);
}
