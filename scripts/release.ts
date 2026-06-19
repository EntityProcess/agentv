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
 *   2. Uses main for stable/next releases, and finalizes only when main points at the prerelease tag
 *   3. Syncs git state from origin
 *   4. Bumps version in all package.json files
 *   5. Commits the version bump
 *   6. Creates a git tag
 *   7. Pushes the release commit and tag to origin
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

interface FinalizeTarget {
  tag: string;
  commit: string;
  prereleaseVersion: string;
  stableVersion: string;
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

async function currentBranch(): Promise<string> {
  return (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
}

async function commitForRef(ref: string): Promise<string> {
  return (await $`git rev-list -n 1 ${ref}`.text()).trim();
}

async function packageJsonAtRef(ref: string, path: string): Promise<PackageJson> {
  return JSON.parse(await $`git show ${ref}:${path}`.text()) as PackageJson;
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

async function isAncestor(ancestor: string, descendant: string): Promise<boolean> {
  const result = await $`git merge-base --is-ancestor ${ancestor} ${descendant}`.nothrow();
  return result.exitCode === 0;
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

async function resolveFinalizeTarget(explicitTag?: string): Promise<FinalizeTarget> {
  const prereleaseTag = explicitTag
    ? normalizePrereleaseTag(explicitTag)
    : await resolveLatestPrereleaseTag();
  const existingTag = (await $`git tag -l ${prereleaseTag}`.text()).trim();

  if (!existingTag) {
    throw new Error(`Prerelease tag ${prereleaseTag} does not exist`);
  }

  const versionAtTag = await packageJsonAtRef(prereleaseTag, PRIMARY_PACKAGE);
  const parsedVersion = parseNextPrerelease(versionAtTag.version);
  if (!parsedVersion) {
    throw new Error(
      `Tag ${prereleaseTag} does not point to a prerelease version in ${PRIMARY_PACKAGE} (found ${versionAtTag.version})`,
    );
  }

  return {
    tag: prereleaseTag,
    commit: await commitForRef(prereleaseTag),
    prereleaseVersion: versionAtTag.version,
    stableVersion: parsedVersion.baseVersion,
  };
}

async function prepareFinalizeMain(target: FinalizeTarget): Promise<void> {
  const branch = await currentBranch();
  if (branch !== 'main') {
    throw new Error(
      `Finalize must run on main so the stable version commit can be pushed (currently on: ${branch})`,
    );
  }

  console.log('📥 Pulling latest changes...');
  await $`git pull origin main`;

  const head = (await $`git rev-parse HEAD`.text()).trim();
  const releaseTag = `v${target.stableVersion}`;
  const existingReleaseTag = (await $`git tag -l ${releaseTag}`.text()).trim();
  if (existingReleaseTag && head === (await commitForRef(releaseTag))) {
    return;
  }

  if (head !== target.commit) {
    throw new Error(
      `Cannot finalize ${target.tag} because main is at ${shortCommit(head)}, not ${shortCommit(target.commit)}. Create a new prerelease from current main, or finalize before additional commits land on main.`,
    );
  }
}

async function ensureFinalizeBranchStillMatches(
  target: FinalizeTarget,
  currentVersion: string,
): Promise<void> {
  const head = (await $`git rev-parse HEAD`.text()).trim();
  if (head !== target.commit) {
    throw new Error(
      `Cannot finalize ${target.tag} because main is at ${shortCommit(head)}, not ${shortCommit(target.commit)}.`,
    );
  }

  if (currentVersion !== target.prereleaseVersion) {
    throw new Error(
      `Cannot finalize ${target.tag} because ${PRIMARY_PACKAGE} on main is ${currentVersion}, but the prerelease tag contains ${target.prereleaseVersion}.`,
    );
  }
}

async function finishExistingFinalizeTag(
  target: FinalizeTarget,
  newVersion: string,
): Promise<void> {
  const releaseTag = `v${newVersion}`;
  const existingVersionAtTag = await packageJsonAtRef(releaseTag, PRIMARY_PACKAGE);

  if (existingVersionAtTag.version !== newVersion) {
    throw new Error(
      `Tag ${releaseTag} already exists, but ${PRIMARY_PACKAGE} contains version ${existingVersionAtTag.version}`,
    );
  }

  const head = (await $`git rev-parse HEAD`.text()).trim();
  const releaseCommit = await commitForRef(releaseTag);

  if (head === releaseCommit) {
    console.log(`ℹ️  Tag ${releaseTag} already exists with version ${newVersion}`);
    console.log(`\n✅ Release tag ${releaseTag} already exists on main; continuing\n`);
    console.log('Next steps:');
    console.log('  1. Publish from the existing release tag');
    return;
  }

  if (head !== target.commit) {
    throw new Error(
      `Tag ${releaseTag} already exists, but main is at ${shortCommit(head)} instead of ${shortCommit(target.commit)} or ${shortCommit(releaseCommit)}.`,
    );
  }

  if (!(await isAncestor(head, releaseCommit))) {
    throw new Error(
      `Tag ${releaseTag} already exists, but it cannot be fast-forwarded from ${target.tag} on main.`,
    );
  }

  console.log(`ℹ️  Tag ${releaseTag} already exists with version ${newVersion}`);
  console.log(`🔀 Fast-forwarding main to existing release tag ${releaseTag}...`);
  await $`git merge --ff-only ${releaseCommit}`;

  console.log('🚀 Pushing main to origin...');
  await $`git push --no-verify origin main`;

  console.log(`\n✅ Release tag ${releaseTag} already exists; main now contains ${newVersion}\n`);
  console.log('Next steps:');
  console.log('  1. Publish from the existing release tag');
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

  let finalizeTarget: FinalizeTarget | undefined;
  if (channel === 'finalize') {
    console.log('📥 Fetching latest tags...');
    await $`git fetch origin --tags`;
    finalizeTarget = await resolveFinalizeTarget(prereleaseTag);
    await prepareFinalizeMain(finalizeTarget);
  } else {
    // Check we're on main branch
    const branch = await currentBranch();
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
        ? (finalizeTarget?.stableVersion ?? finalizeVersion(currentVersion))
        : bumpVersion(currentVersion, bumpType ?? 'patch');

  const releaseMode =
    channel === 'next'
      ? `${NEXT_PRERELEASE_TAG}${bumpType ? ` (${bumpType})` : ' (increment)'}`
      : channel === 'finalize'
        ? `finalize${finalizeTarget ? ` from ${finalizeTarget.tag}` : ''}`
        : (bumpType ?? 'patch');
  console.log(`\n📦 Bumping version: ${currentVersion} → ${newVersion} [${releaseMode}]\n`);

  // Check if tag already exists
  const existingTags = (await $`git tag -l v${newVersion}`.text()).trim();
  if (existingTags) {
    if (channel === 'finalize') {
      if (!finalizeTarget) {
        throw new Error('Finalize target was not resolved');
      }
      await finishExistingFinalizeTag(finalizeTarget, newVersion);
      return;
    }

    console.error(`❌ Tag v${newVersion} already exists`);
    process.exit(1);
  }

  if (channel === 'finalize') {
    if (!finalizeTarget) {
      throw new Error('Finalize target was not resolved');
    }
    await ensureFinalizeBranchStillMatches(finalizeTarget, currentVersion);
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
  await $`git push --no-verify origin main`;
  await $`git push --no-verify origin v${newVersion}`;

  console.log(`\n✅ Released v${newVersion}\n`);
  console.log('Next steps:');
  console.log('  1. Publish from the pushed release tag');
}

main().catch((error) => {
  console.error('❌ Release failed:', error.message || error);
  process.exit(1);
});
