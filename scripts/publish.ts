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

import { $ } from 'bun';

const tag = process.argv[2]; // 'next' | undefined (defaults to latest)
const tagArgs = tag ? ['--tag', tag] : [];

const PACKAGES = ['packages/core', 'packages/eval', 'apps/cli'];

async function main() {
  for (const pkg of PACKAGES) {
    console.log(`\n📦 Publishing ${pkg}${tag ? ` (--tag ${tag})` : ''}...`);
    try {
      await $`npm publish ${tagArgs}`.cwd(pkg).env({ ...process.env, ALLOW_PUBLISH: '1' });
    } catch (error) {
      console.error(`❌ Failed to publish ${pkg}`);
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
