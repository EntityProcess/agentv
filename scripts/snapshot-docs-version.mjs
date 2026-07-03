#!/usr/bin/env node
import { execFile as execFileWithCallback } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const VERSION_SLUG_PATTERN = /^v\d+\.\d+\.\d+$/;
const LIVE_SUBDIR = 'next';

const version = process.argv[2];
const sourceRef = process.argv[3] ?? version;
const execFile = promisify(execFileWithCallback);

if (!version || !VERSION_SLUG_PATTERN.test(version)) {
  console.error('Usage: node scripts/snapshot-docs-version.mjs vX.Y.Z [source-ref]');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repoRoot, 'apps/web/src/content/docs/docs');
const snapshotRoot = path.join(docsRoot, version);
const routeManifestPath = path.join(repoRoot, `apps/web/src/data/docs-${version}-routes.json`);
const docsTreePath = 'apps/web/src/content/docs/docs';

const tempRoot = await mkdtemp(path.join(tmpdir(), 'agentv-docs-snapshot-'));
const archivePath = path.join(tempRoot, 'docs.tar');
const sourceRoot = path.join(tempRoot, 'source');
const extractedDocsRoot = path.join(sourceRoot, docsTreePath);

await rm(snapshotRoot, { recursive: true, force: true });
await mkdir(snapshotRoot, { recursive: true });
await mkdir(sourceRoot, { recursive: true });

const liveRoot = path.join(extractedDocsRoot, LIVE_SUBDIR);

try {
  await execFile('git', ['cat-file', '-e', `${sourceRef}:${docsTreePath}/${LIVE_SUBDIR}`], {
    cwd: repoRoot,
  });
  const { stdout } = await execFile('git', ['archive', '--format=tar', sourceRef, docsTreePath], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 50 * 1024 * 1024,
  });
  await writeFile(archivePath, stdout);
  await execFile('tar', ['-xf', archivePath, '-C', sourceRoot]);
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw new Error(
    `'${sourceRef}' has no live docs at ${docsTreePath}/${LIVE_SUBDIR}. Snapshots are cut from the live 'next' tree.`,
    { cause: error },
  );
}

const liveEntries = await readdir(liveRoot, { withFileTypes: true });
for (const entry of liveEntries) {
  if (VERSION_SLUG_PATTERN.test(entry.name)) continue;
  await cp(path.join(liveRoot, entry.name), path.join(snapshotRoot, entry.name), {
    recursive: true,
  });
}

const files = await collectMarkdownFiles(snapshotRoot);
const archiveRoutes = files.map((file) => getSnapshotHref(file)).sort();
const archiveRouteSet = new Set(archiveRoutes);

await Promise.all(
  files.map(async (file) => {
    const source = await readFile(file, 'utf8');
    const rewritten = rewriteSnapshotContent(
      source,
      version,
      getSnapshotSlug(file),
      archiveRouteSet,
    );
    await writeFile(file, rewritten);
  }),
);

await mkdir(path.dirname(routeManifestPath), { recursive: true });
await writeFile(routeManifestPath, `${JSON.stringify(archiveRoutes, null, 2)}\n`);

console.log(`Generated ${version} docs snapshot at ${path.relative(repoRoot, snapshotRoot)}`);
console.log(`Snapshot source ref: ${sourceRef}`);
console.log(`Wrote archive route manifest at ${path.relative(repoRoot, routeManifestPath)}`);
await rm(tempRoot, { recursive: true, force: true });

async function collectMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(entryPath)));
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function getSnapshotSlug(file) {
  const relative = path.relative(snapshotRoot, file).replace(/\\/g, '/');
  const withoutExtension = relative.replace(/\.(md|mdx)$/, '');
  const suffix = withoutExtension === 'index' ? '' : withoutExtension.replace(/\/index$/, '');
  return ['docs', version, suffix].filter(Boolean).join('/');
}

function getSnapshotHref(file) {
  return `/${getSnapshotSlug(file)}/`;
}

function rewriteSnapshotContent(source, version, slug, archiveRouteSet) {
  const rewritten = source
    .replace(/\]\(\/docs\/([^)#]*)(#[^)]+)?\)/g, (match, targetPath, hash = '') => {
      const archiveHref = toArchiveHref(version, targetPath, hash);
      return archiveRouteSet.has(stripHash(archiveHref)) ? `](${archiveHref})` : match;
    })
    .replace(/href="\/docs\/([^"#]*)(#[^"]+)?"/g, (match, targetPath, hash = '') => {
      const archiveHref = toArchiveHref(version, targetPath, hash);
      return archiveRouteSet.has(stripHash(archiveHref)) ? `href="${archiveHref}"` : match;
    })
    .replace(/href='\/docs\/([^'#]*)(#[^']+)?'/g, (match, targetPath, hash = '') => {
      const archiveHref = toArchiveHref(version, targetPath, hash);
      return archiveRouteSet.has(stripHash(archiveHref)) ? `href='${archiveHref}'` : match;
    });

  return upsertFrontmatter(rewritten, {
    slug: [`slug: ${slug}`],
    editUrl: ['editUrl: false'],
    pagefind: ['pagefind: false'],
  });
}

function toArchiveHref(version, targetPath, hash) {
  const normalizedTarget = targetPath.replace(/^\/+/, '').replace(/\/?$/, '/');
  return `/docs/${version}/${normalizedTarget}${hash}`;
}

function stripHash(href) {
  return href.split('#')[0];
}

function upsertFrontmatter(source, fields) {
  if (!source.startsWith('---\n')) {
    return `---\n${serializeFields(fields)}\n---\n\n${source}`;
  }

  const end = source.indexOf('\n---', 4);
  if (end === -1) {
    return `---\n${serializeFields(fields)}\n---\n\n${source}`;
  }

  let frontmatter = source.slice(4, end);
  const body = source.slice(end);

  for (const [key, lines] of Object.entries(fields)) {
    const pattern = new RegExp(`^${key}:\\s*(?:\\n(?:  .*(?:\\n|$))*)?`, 'm');
    const replacement = lines.join('\n');
    if (pattern.test(frontmatter)) {
      frontmatter = frontmatter.replace(pattern, replacement);
    } else {
      frontmatter = `${frontmatter.trimEnd()}\n${replacement}\n`;
    }
  }

  return `---\n${frontmatter.trimEnd()}\n${body}`;
}

function serializeFields(fields) {
  return Object.values(fields)
    .map((lines) => lines.join('\n'))
    .join('\n');
}
