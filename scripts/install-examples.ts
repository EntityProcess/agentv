#!/usr/bin/env bun
/**
 * Install dependencies for all example directories.
 *
 * Examples are self-contained (not part of the monorepo workspace) and require
 * separate `bun install` runs to install their dependencies.
 *
 * Usage: bun scripts/install-examples.ts
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXAMPLES_ROOT = path.join(import.meta.dir, '..', 'examples');

async function findExampleDirs(dir: string): Promise<string[]> {
  const examples: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.')) continue;

      const subdir = path.join(current, entry.name);
      const pkgPath = path.join(subdir, 'package.json');

      if (fs.existsSync(pkgPath)) {
        examples.push(subdir);
      } else {
        // Recurse into subdirectories
        await walk(subdir);
      }
    }
  }

  await walk(dir);
  return examples;
}

async function runBunInstall(dir: string): Promise<void> {
  const relativePath = path.relative(process.cwd(), dir);
  console.log(`Installing dependencies in ${relativePath}...`);

  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['install'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`bun install failed with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  console.log('Finding example directories...\n');

  const examples = await findExampleDirs(EXAMPLES_ROOT);

  if (examples.length === 0) {
    console.log('No example directories found.');
    return;
  }

  console.log(`Found ${examples.length} example(s):\n`);

  for (const example of examples) {
    try {
      await runBunInstall(example);
      console.log();
    } catch (error) {
      console.error(`Failed to install dependencies for ${example}:`, error);
      process.exit(1);
    }
  }

  console.log('All example dependencies installed successfully!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
