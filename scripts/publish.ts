#!/usr/bin/env bun
/**
 * Publish all AgentV packages to npm.
 *
 * Sets ALLOW_PUBLISH=1 so the prepublishOnly guard in each package.json
 * allows the publish to proceed. This is the only sanctioned way to publish;
 * running `npm publish` directly in a package directory will be blocked.
 *
 * Usage:
 *   bun scripts/publish.ts          # publish to latest
 *   bun scripts/publish.ts next     # publish to next
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const requestedTag = process.argv[2]; // 'next' | undefined (defaults to latest)
if (requestedTag !== undefined && requestedTag !== 'next') {
  console.error(`❌ Invalid npm dist-tag: ${requestedTag}`);
  console.error('   Usage: bun scripts/publish.ts [next]');
  process.exit(1);
}

const npmTag = requestedTag ?? 'latest';
const tagArgs = ['--tag', npmTag];

const PACKAGES = ['packages/core', 'packages/sdk', 'packages/eval', 'apps/cli'];

interface PackageJson {
  name: string;
  version: string;
}

type DistTags = Record<string, string | undefined>;

function readPackageJson(pkgDir: string): PackageJson {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as PackageJson;
}

async function npmJson(args: string[], options: { allowNotFound?: boolean } = {}) {
  const result = await $`npm ${args}`.quiet().nothrow();
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  if (result.exitCode === 0) {
    return stdout ? JSON.parse(stdout) : undefined;
  }

  if (options.allowNotFound && (stdout.includes('"E404"') || stderr.includes('E404'))) {
    return undefined;
  }

  throw new Error(`npm ${args.join(' ')} failed:\n${stderr || stdout}`);
}

async function getPublishedVersion(name: string, version: string): Promise<string | undefined> {
  const publishedVersion = await npmJson(['view', `${name}@${version}`, 'version', '--json'], {
    allowNotFound: true,
  });
  return typeof publishedVersion === 'string' ? publishedVersion : undefined;
}

async function getDistTags(name: string): Promise<DistTags> {
  const tags = await npmJson(['view', name, 'dist-tags', '--json'], { allowNotFound: true });
  return tags && typeof tags === 'object' ? (tags as DistTags) : {};
}

function assertNoDowngrade(name: string, currentVersion: string | undefined, nextVersion: string) {
  if (!currentVersion || currentVersion === nextVersion) {
    return;
  }

  if (Bun.semver.order(nextVersion, currentVersion) < 0) {
    throw new Error(
      `Refusing to move ${name}@${npmTag} backward from ${currentVersion} to ${nextVersion}`,
    );
  }
}

function assertVersionMatchesTag(name: string, version: string) {
  const isPrerelease = version.includes('-next.');

  if (isPrerelease && npmTag !== 'next') {
    throw new Error(`Refusing to publish prerelease ${name}@${version} to ${npmTag}`);
  }

  if (!isPrerelease && npmTag === 'next') {
    throw new Error(`Refusing to publish stable ${name}@${version} to next`);
  }
}

async function ensureDistTag(name: string, version: string) {
  const tags = await getDistTags(name);
  assertNoDowngrade(name, tags[npmTag], version);

  if (tags[npmTag] === version) {
    console.log(`   ✓ ${name}@${npmTag} already points to ${version}`);
    return;
  }

  console.log(`   → Setting ${name}@${npmTag} to ${version}`);
  await $`npm dist-tag add ${name}@${version} ${npmTag}`;
}

async function main() {
  for (const pkg of PACKAGES) {
    const packageJson = readPackageJson(pkg);
    const { name, version } = packageJson;
    assertVersionMatchesTag(name, version);

    const publishedVersion = await getPublishedVersion(name, version);

    console.log(`\n📦 Publishing ${name}@${version} (--tag ${npmTag})...`);
    try {
      if (publishedVersion === version) {
        console.log(`   ✓ ${name}@${version} is already published`);
      } else {
        await $`npm publish ${tagArgs}`.cwd(pkg).env({ ...process.env, ALLOW_PUBLISH: '1' });
      }

      await ensureDistTag(name, version);
    } catch (error) {
      console.error(`❌ Failed to publish ${name}@${version}`);
      throw error;
    }
  }

  console.log('\n✅ All packages published.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ ${message}`);
  process.exit(1);
});
