import { command, flag, subcommands } from 'cmd-ts';

import { RepoManager } from '@agentv/core';

const cleanCommand = command({
  name: 'clean',
  description: 'Remove all cached git repositories',
  args: {
    force: flag({
      long: 'force',
      short: 'f',
      description: 'Skip confirmation prompt',
    }),
  },
  handler: async ({ force }) => {
    if (!force) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question('Remove all cached git repos from ~/.agentv/git-cache/? [y/N] ', resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    const manager = new RepoManager();
    await manager.cleanCache();
    console.log('Cache cleaned.');
  },
});

export const cacheCommand = subcommands({
  name: 'cache',
  description: 'Manage AgentV cache',
  cmds: {
    clean: cleanCommand,
  },
});
