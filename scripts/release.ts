#!/usr/bin/env bun
/**
 * Simple version bump and release script
 *
 * Usage:
 *   bun scripts/release.ts [patch|minor|major]         # stable release
 *   bun scripts/release.ts next [patch|minor|major]    # new pre-release series
 *   bun scripts/release.ts next                        # increment pre-release (e.g. next.1 -> next.2)
 *   bun scripts/release.ts finalize [prerelease-tag]   # promote a pre-release tag to stable (e.g. v4.12.0-next.3 -> 4.12.0)
 *
 * This script:
 *   1. Validates the working directory is clean
 *   2. Uses main for stable/next releases, or a prerelease tag for finalize
 *   3. Syncs git state from origin
 *   4. Bumps version in all package.json files
 *   5. Commits the version bump
 *   6. Creates a git tag
 *   7. Pushes the release commit/tag for stable/next, or the stable tag for finalize
 *
 * The publish workflow calls this script first, then publishes npm packages from
 * the resolved release tag in a separate job in the same workflow file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';

type BumpType = 'patch' | 'minor' | 'major';
type ReleaseChannel = 'stable' | 'next' | 'finalize';

const VALID_BUMP_TYPES: BumpType[] = ['patch', 'minor', 'major'];
const NEXT_PRERELEASE_TAG = 'next';

// Packages to update (relative to repo root)
const PACKAGE_PATHS = [
  'packages/core/package.json',
  'packages/sdk/package.json',
  'packages/eval/package.json',
  'apps/cli/package.json',
];

// The primary package that determines the version
const PRIMARY_PACKAGE = 'apps/cli/package.json';

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

interface ParsedArgs {
  channel: ReleaseChannel;
  bumpType?: BumpType;
  prereleaseTag?: string;
}

function readPackageJson(path: string): PackageJson {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as PackageJson;
}

function writePackageJson(path: string, pkg: PackageJson): void {
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

function bumpVersion(currentVersion: string, bumpType: BumpType): string {
  const stablePart = currentVersion.split('-')[0];
  const parts = stablePart.split('.').map(Number);

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid version format: ${currentVersion}`);
  }

  const [major, minor, patch] = parts;

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function parseNextPrerelease(version: string): { baseVersion: string; number: number } | undefined {
  const match = version.match(/^(\d+\.\d+\.\d+)-next\.(\d+)$/);
  if (!match) {
    return undefined;
  }

  return {
    baseVersion: match[1],
    number: Number.parseInt(match[2], 10),
  };
}

function finalizeVersion(currentVersion: string): string {
  const parsed = parseNextPrerelease(currentVersion);
  if (!parsed) {
    throw new Error(
      `Version ${currentVersion} is not a pre-release version (expected format: X.Y.Z-next.N)`,
    );
  }
  return parsed.baseVersion;
}

function bumpNextVersion(currentVersion: string, bumpType?: BumpType): string {
  const parsedNext = parseNextPrerelease(currentVersion);

  if (parsedNext && !bumpType) {
    return `${parsedNext.baseVersion}-${NEXT_PRERELEASE_TAG}.${parsedNext.number + 1}`;
  }

  const baseBump = bumpType ?? 'patch';
  const baseVersion = parsedNext ? parsedNext.baseVersion : currentVersion;
  const bumpedBase = bumpVersion(baseVersion, baseBump);
  return `${bumpedBase}-${NEXT_PRERELEASE_TAG}.1`;
}

function normalizePrereleaseTag(tag: string): string {
  return tag.startsWith('v') ? tag : `v${tag}`;
}

async function resolveLatestPrereleaseTag(): Promise<string> {
  const latestTag = (await $`git tag --list v*-next.* --sort=-version:refname`.text())
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!latestTag) {
    throw new Error('No prerelease tags found (expected tags like vX.Y.Z-next.N)');
  }

  return latestTag;
}

async function resolveFinalizeTag(explicitTag?: string): Promise<string> {
  const prereleaseTag = explicitTag
    ? normalizePrereleaseTag(explicitTag)
    : await resolveLatestPrereleaseTag();
  const existingTag = (await $`git tag -l ${prereleaseTag}`.text()).trim();

  if (!existingTag) {
    throw new Error(`Prerelease tag ${prereleaseTag} does not exist`);
  }

  const versionAtTag = JSON.parse(
    await $`git show ${prereleaseTag}:${PRIMARY_PACKAGE}`.text(),
  ) as PackageJson;
  if (!parseNextPrerelease(versionAtTag.version)) {
    throw new Error(
      `Tag ${prereleaseTag} does not point to a prerelease version in ${PRIMARY_PACKAGE} (found ${versionAtTag.version})`,
    );
  }

  return prereleaseTag;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const first = argv[2];
  const second = argv[3];

  if (!first) {
    return { channel: 'stable', bumpType: 'patch' };
  }

  if (first === 'finalize') {
    return { channel: 'finalize', prereleaseTag: second };
  }

  if (first === NEXT_PRERELEASE_TAG) {
    if (second === undefined) {
      return { channel: 'next' };
    }
    if (!VALID_BUMP_TYPES.includes(second as BumpType)) {
      throw new Error(
        `Invalid bump type for next channel: ${second}. Valid options: ${VALID_BUMP_TYPES.join(', ')}`,
      );
    }
    return { channel: 'next', bumpType: second as BumpType };
  }

  if (!VALID_BUMP_TYPES.includes(first as BumpType)) {
    throw new Error(
      `Invalid bump type: ${first}. Valid options: ${VALID_BUMP_TYPES.join(', ')} or '${NEXT_PRERELEASE_TAG}'`,
    );
  }

  return { channel: 'stable', bumpType: first as BumpType };
}

async function main() {
  let channel: ReleaseChannel;
  let bumpType: BumpType | undefined;
  let prereleaseTag: string | undefined;
  try {
    ({ channel, bumpType, prereleaseTag } = parseArgs(process.argv));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    console.error('   Usage: bun scripts/release.ts [patch|minor|major]');
    console.error(`          bun scripts/release.ts ${NEXT_PRERELEASE_TAG} [patch|minor|major]`);
    console.error('          bun scripts/release.ts finalize [prerelease-tag]');
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = (await $`git status --porcelain`.text()).trim();
  if (status) {
    console.error('❌ Working directory has uncommitted changes:');
    console.error(status);
    process.exit(1);
  }

  let resolvedFinalizeTag: string | undefined;
  if (channel === 'finalize') {
    console.log('📥 Fetching latest tags...');
    await $`git fetch origin --tags`;
    resolvedFinalizeTag = await resolveFinalizeTag(prereleaseTag);

    const currentHead = (await $`git rev-parse HEAD`.text()).trim();
    const targetHead = (await $`git rev-list -n 1 ${resolvedFinalizeTag}`.text()).trim();
    if (currentHead !== targetHead) {
      console.log(`🎯 Checking out prerelease tag ${resolvedFinalizeTag}...`);
      await $`git checkout --detach ${resolvedFinalizeTag}`;
    }
  } else {
    // Check we're on main branch
    const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
    if (branch !== 'main') {
      console.error(`❌ Must be on main branch (currently on: ${branch})`);
      process.exit(1);
    }

    // Pull latest changes
    console.log('📥 Pulling latest changes...');
    await $`git pull origin main`;
  }

  // Get current version from primary package
  const primaryPkgPath = resolve(process.cwd(), PRIMARY_PACKAGE);
  const primaryPkg = readPackageJson(primaryPkgPath);
  const currentVersion = primaryPkg.version;
  const newVersion =
    channel === 'next'
      ? bumpNextVersion(currentVersion, bumpType)
      : channel === 'finalize'
        ? finalizeVersion(currentVersion)
        : bumpVersion(currentVersion, bumpType ?? 'patch');

  const releaseMode =
    channel === 'next'
      ? `${NEXT_PRERELEASE_TAG}${bumpType ? ` (${bumpType})` : ' (increment)'}`
      : channel === 'finalize'
        ? `finalize${resolvedFinalizeTag ? ` from ${resolvedFinalizeTag}` : ''}`
        : (bumpType ?? 'patch');
  console.log(`\n📦 Bumping version: ${currentVersion} → ${newVersion} [${releaseMode}]\n`);

  // Check if tag already exists
  const existingTags = (await $`git tag -l v${newVersion}`.text()).trim();
  if (existingTags) {
    if (channel === 'finalize') {
      const existingVersionAtTag = JSON.parse(
        await $`git show v${newVersion}:${PRIMARY_PACKAGE}`.text(),
      ) as PackageJson;

      if (existingVersionAtTag.version === newVersion) {
        console.log(`ℹ️  Tag v${newVersion} already exists with version ${newVersion}`);
        console.log(`🎯 Checking out existing release tag v${newVersion}...`);
        await $`git checkout --detach v${newVersion}`;
        console.log(`\n✅ Release tag v${newVersion} already exists; continuing\n`);
        console.log('Next steps:');
        console.log('  1. Publish from the existing release tag');
        return;
      }

      console.error(
        `❌ Tag v${newVersion} already exists, but ${PRIMARY_PACKAGE} contains version ${existingVersionAtTag.version}`,
      );
      process.exit(1);
    }

    console.error(`❌ Tag v${newVersion} already exists`);
    process.exit(1);
  }

  // Update all package.json files
  for (const pkgPath of PACKAGE_PATHS) {
    const fullPath = resolve(process.cwd(), pkgPath);
    const pkg = readPackageJson(fullPath);
    const oldVersion = pkg.version;
    pkg.version = newVersion;
    writePackageJson(fullPath, pkg);
    console.log(`   ✓ ${pkg.name}: ${oldVersion} → ${newVersion}`);
  }

  // Format modified files so they pass lint
  for (const pkgPath of PACKAGE_PATHS) {
    await $`bunx biome format --write ${pkgPath}`;
  }

  // Stage changes
  console.log('\n📝 Committing version bump...');
  for (const pkgPath of PACKAGE_PATHS) {
    await $`git add ${pkgPath}`;
  }

  // Commit
  await $`git commit -m "chore: release v${newVersion}"`;

  // Create tag
  console.log(`🏷️  Creating tag v${newVersion}...`);
  await $`git tag -a v${newVersion} -m "Release v${newVersion}"`;

  // Push
  console.log('🚀 Pushing to origin...');
  if (channel !== 'finalize') {
    await $`git push --no-verify origin main`;
  }
  await $`git push --no-verify origin v${newVersion}`;

  console.log(`\n✅ Released v${newVersion}\n`);
  console.log('Next steps:');
  console.log('  1. Publish from the pushed release tag');
}

main().catch((error) => {
  console.error('❌ Release failed:', error.message || error);
  process.exit(1);
});
