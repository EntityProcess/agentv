#!/usr/bin/env bun
/**
 * Manage npm dist-tags across all published AgentV packages.
 *
 * Usage:
 *   bun scripts/tag-channel.ts <next|latest> [version]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';

type DistTag = 'next' | 'latest';

type PackageConfig = {
  path: string;
  name: string;
  version: string;
};

const VALID_TAGS: DistTag[] = ['next', 'latest'];
const PACKAGE_PATHS = [
  'packages/core/package.json',
  'packages/eval/package.json',
  'apps/cli/package.json',
];

function readPackage(path: string): PackageConfig {
  const fullPath = resolve(process.cwd(), path);
  const content = readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(content) as { name?: string; version?: string };

  if (!parsed.name || !parsed.version) {
    throw new Error(`Invalid package.json at ${path}: missing name/version`);
  }

  return {
    path,
    name: parsed.name,
    version: parsed.version,
  };
}

function parseArgs(argv: readonly string[]): { tag: DistTag; version?: string } {
  const tag = argv[2];
  const version = argv[3];

  if (!tag) {
    throw new Error('Missing dist-tag. Usage: bun scripts/tag-channel.ts <next|latest> [version]');
  }

  if (!VALID_TAGS.includes(tag as DistTag)) {
    throw new Error(`Invalid dist-tag: ${tag}. Valid options: ${VALID_TAGS.join(', ')}`);
  }

  return { tag: tag as DistTag, version };
}

async function main() {
  const { tag, version: requestedVersion } = parseArgs(process.argv);
  const packages = PACKAGE_PATHS.map(readPackage);
  const detectedVersion = packages[0]?.version;

  if (!detectedVersion) {
    throw new Error('Could not detect version from package files');
  }

  const targetVersion = requestedVersion ?? detectedVersion;
  const mismatches = packages.filter((pkg) => pkg.version !== targetVersion);

  if (!requestedVersion && mismatches.length > 0) {
    console.error('❌ Package versions are not aligned. Pass explicit version to continue:');
    console.error(`   bun scripts/tag-channel.ts ${tag} <version>`);
    for (const pkg of packages) {
      console.error(`   - ${pkg.name} (${pkg.path}): ${pkg.version}`);
    }
    process.exit(1);
  }

  console.log(`🏷️  Tagging npm dist-tag '${tag}' -> ${targetVersion}\n`);

  for (const pkg of packages) {
    const spec = `${pkg.name}@${targetVersion}`;
    console.log(`• ${spec}`);
    await $`npm dist-tag add ${spec} ${tag}`.quiet();
  }

  console.log('\n✅ Updated npm dist-tags.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  process.exit(1);
});
