import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { command, flag, option, string } from 'cmd-ts';

import { RepoManager } from '@agentv/core';

export const addCommand = command({
  name: 'add',
  description: 'Seed cache from a local git repository',
  args: {
    url: option({
      long: 'url',
      description: 'Remote URL to associate with the cache entry',
      type: string,
    }),
    from: option({
      long: 'from',
      description: 'Path to local git repository to clone from',
      type: string,
    }),
    force: flag({
      long: 'force',
      short: 'f',
      description: 'Overwrite existing cache entry',
    }),
  },
  handler: async ({ url, from, force }) => {
    const localPath = resolve(from);
    if (!existsSync(localPath)) {
      console.error(`Error: local path does not exist: ${localPath}`);
      process.exit(1);
    }

    const manager = new RepoManager();
    try {
      const cachePath = await manager.seedCache(localPath, url, { force });
      console.log(`Cache seeded from ${localPath}`);
      console.log(`  Remote URL: ${url}`);
      console.log(`  Cache path: ${cachePath}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  },
});
