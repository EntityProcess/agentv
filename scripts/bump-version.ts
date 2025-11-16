#!/usr/bin/env tsx
/**
 * Version bump script for AgentEvo packages
 * 
 * Usage:
 *   pnpm tsx scripts/bump-version.ts <version>
 *   pnpm tsx scripts/bump-version.ts patch
 *   pnpm tsx scripts/bump-version.ts minor
 *   pnpm tsx scripts/bump-version.ts major
 *   pnpm tsx scripts/bump-version.ts 0.3.0
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PACKAGE_PATHS = [
  'packages/core/package.json',
  'apps/cli/package.json',
] as const;

type VersionBump = 'major' | 'minor' | 'patch';

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return parts as [number, number, number];
}

function bumpVersion(current: string, bump: VersionBump | string): string {
  if (!['major', 'minor', 'patch'].includes(bump)) {
    // Treat as explicit version
    parseVersion(bump); // Validate format
    return bump;
  }

  const [major, minor, patch] = parseVersion(current);
  
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${bump}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: bump-version.ts <major|minor|patch|x.y.z>');
    process.exit(1);
  }

  const bumpType = args[0];
  
  // Read current version from core package
  const corePath = resolve(process.cwd(), PACKAGE_PATHS[0]);
  const corePackage = JSON.parse(readFileSync(corePath, 'utf-8'));
  const currentVersion = corePackage.version;
  
  // Calculate new version
  const newVersion = bumpVersion(currentVersion, bumpType);
  
  console.log(`Bumping version: ${currentVersion} → ${newVersion}\n`);
  
  // Update all packages
  for (const packagePath of PACKAGE_PATHS) {
    const fullPath = resolve(process.cwd(), packagePath);
    const content = readFileSync(fullPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    pkg.version = newVersion;
    
    // Write with 2-space indentation and trailing newline
    writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    
    console.log(`✓ Updated ${packagePath}`);
  }
  
  console.log(`\nVersion bumped to ${newVersion}`);
  console.log('\nNext steps:');
  console.log('  1. Review changes: git diff');
  console.log('  2. Commit: git commit -am "chore: bump version to ' + newVersion + '"');
  console.log('  3. Tag: git tag v' + newVersion);
  console.log('  4. Push: git push && git push --tags');
}

main();
