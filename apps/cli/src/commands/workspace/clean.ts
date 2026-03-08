import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { command, flag, option, optional, string } from 'cmd-ts';

import { getWorkspacePoolRoot } from '@agentv/core';

interface PoolMetadata {
  fingerprint: string;
  templatePath: string | null;
  repos: readonly { path: string; source: { type: string; url?: string; path?: string } }[];
  createdAt: string;
}

async function confirm(message: string): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return answer.toLowerCase() === 'y';
}

export const cleanCommand = command({
  name: 'clean',
  description: 'Remove workspace pool entries',
  args: {
    repo: option({
      type: optional(string),
      long: 'repo',
      description: 'Only remove pools containing this repo URL',
    }),
    force: flag({
      long: 'force',
      short: 'f',
      description: 'Skip confirmation prompt',
    }),
  },
  handler: async ({ repo, force }) => {
    const poolRoot = getWorkspacePoolRoot();

    if (!existsSync(poolRoot)) {
      console.log('No workspace pool entries found.');
      return;
    }

    if (repo) {
      // Remove only pool entries matching the repo URL
      const entries = await readdir(poolRoot, { withFileTypes: true });
      const poolDirs = entries.filter((e) => e.isDirectory());
      const matchingDirs: string[] = [];

      for (const dir of poolDirs) {
        const poolDir = path.join(poolRoot, dir.name);
        const metadataPath = path.join(poolDir, 'metadata.json');

        try {
          const raw = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(raw) as PoolMetadata;

          const hasRepo = metadata.repos?.some((r) => {
            if (r.source.type === 'git' && r.source.url) {
              return r.source.url.toLowerCase().includes(repo.toLowerCase());
            }
            return false;
          });

          if (hasRepo) {
            matchingDirs.push(poolDir);
          }
        } catch {
          // Skip entries without valid metadata
        }
      }

      if (matchingDirs.length === 0) {
        console.log(`No workspace pool entries found matching repo "${repo}".`);
        return;
      }

      if (!force) {
        const confirmed = await confirm(
          `Remove ${matchingDirs.length} pool entry(s) matching repo "${repo}"?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      for (const dir of matchingDirs) {
        await rm(dir, { recursive: true, force: true });
        console.log(`Removed: ${path.basename(dir).slice(0, 12)}...`);
      }
      console.log('Done.');
    } else {
      // Remove entire pool root
      if (!force) {
        const confirmed = await confirm(
          `Remove all workspace pool entries from ${poolRoot}?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      await rm(poolRoot, { recursive: true, force: true });
      console.log('Workspace pool cleaned.');
    }
  },
});
