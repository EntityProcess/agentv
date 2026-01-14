import { command, flag, oneOf, option, optional, string, subcommands } from 'cmd-ts';

import { workspaceCreateCommand } from './create.js';
import { workspaceSyncCommand } from './sync.js';

export const workspaceCommand = subcommands({
  name: 'workspace',
  description: 'Manage AgentV workspaces',
  cmds: {
    create: command({
      name: 'create',
      description: 'Create a workspace config file',
      args: {
        out: option({
          long: 'out',
          type: optional(string),
          description:
            'Workspace output directory (default: .agentv/workspaces/<timestamp> under the current working directory)',
        }),
        workspaceRoot: option({
          long: 'workspace-root',
          type: optional(string),
          description: 'Alias for --out',
        }),
        config: option({
          long: 'config',
          type: optional(string),
          description:
            'Path to workspace config file (default: <workspace-root>/.agentv/workspace.yaml)',
        }),
        force: flag({
          long: 'force',
          description: 'Overwrite the destination directory if it exists',
        }),
      },
      handler: async (args) => {
        const result = await workspaceCreateCommand(args);
        console.log(`Workspace root: ${result.workspaceRoot}`);
        console.log(`Config path: ${result.configPath}`);
      },
    }),

    sync: command({
      name: 'sync',
      description: 'Sync workspace from configured sources',
      args: {
        config: option({
          long: 'config',
          type: string,
          description: 'Path to workspace config file',
        }),
        mode: option({
          long: 'mode',
          type: optional(oneOf(['copy', 'symlink'] as const)),
          description: "Override workspace mode (default: config.mode or 'copy')",
        }),
      },
      handler: async (args) => {
        await workspaceSyncCommand(args);
      },
    }),
  },
});
