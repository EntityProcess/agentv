#!/usr/bin/env bun
/**
 * Simple version bump and release script
 *
 * Usage:
 *   bun scripts/release.ts [patch|minor|major]
 *
 * This script:
 *   1. Validates we're on the main branch
 *   2. Validates working directory is clean
 *   3. Pulls latest changes
 *   4. Bumps version in all package.json files
 *   5. Commits the version bump
 *   6. Creates a git tag
 *   7. Pushes commit and tag to origin
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';

type BumpType = 'patch' | 'minor' | 'major';

const VALID_BUMP_TYPES: BumpType[] = ['patch', 'minor', 'major'];

// Packages to update (relative to repo root)
const PACKAGE_PATHS = [
  'packages/core/package.json',
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

function readPackageJson(path: string): PackageJson {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as PackageJson;
}

function writePackageJson(path: string, pkg: PackageJson): void {
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

function bumpVersion(currentVersion: string, bumpType: BumpType): string {
  const parts = currentVersion.split('.').map(Number);

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

async function main() {
  const bumpType = (process.argv[2] || 'patch') as BumpType;

  // Validate bump type
  if (!VALID_BUMP_TYPES.includes(bumpType)) {
    console.error(`❌ Invalid bump type: ${bumpType}`);
    console.error(`   Valid options: ${VALID_BUMP_TYPES.join(', ')}`);
    process.exit(1);
  }

  // Check we're on main branch
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
  if (branch !== 'main') {
    console.error(`❌ Must be on main branch (currently on: ${branch})`);
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = (await $`git status --porcelain`.text()).trim();
  if (status) {
    console.error('❌ Working directory has uncommitted changes:');
    console.error(status);
    process.exit(1);
  }

  // Pull latest changes
  console.log('📥 Pulling latest changes...');
  await $`git pull origin main`;

  // Get current version from primary package
  const primaryPkgPath = resolve(process.cwd(), PRIMARY_PACKAGE);
  const primaryPkg = readPackageJson(primaryPkgPath);
  const currentVersion = primaryPkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\n📦 Bumping version: ${currentVersion} → ${newVersion} (${bumpType})\n`);

  // Check if tag already exists
  const existingTags = (await $`git tag -l v${newVersion}`.text()).trim();
  if (existingTags) {
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
  await $`git push origin main`;
  await $`git push origin v${newVersion}`;

  console.log(`\n✅ Released v${newVersion}\n`);
  console.log('Next steps:');
  console.log('  1. Run: bun run publish');
  console.log('  2. Create GitHub release (optional)');
}

main().catch((error) => {
  console.error('❌ Release failed:', error.message || error);
  process.exit(1);
});
