import { command, flag, subcommands } from 'cmd-ts';
import packageJson from '../../../package.json' with { type: 'json' };
import { detectPackageManager, performSelfUpdate } from '../../self-update.js';

// Re-export for existing tests
export { detectPackageManagerFromPath } from '../../self-update.js';

const updateCommand = command({
  name: 'update',
  description: 'Update agentv to the latest version',
  args: {
    npm: flag({ long: 'npm', description: 'Force update using npm' }),
    bun: flag({ long: 'bun', description: 'Force update using bun' }),
  },
  handler: async ({ npm, bun }) => {
    if (npm && bun) {
      console.error('Error: Cannot specify both --npm and --bun');
      process.exit(1);
    }

    let pm: 'bun' | 'npm';
    if (npm) {
      pm = 'npm';
    } else if (bun) {
      pm = 'bun';
    } else {
      pm = detectPackageManager();
    }

    const currentVersion = packageJson.version;
    console.log(`Current version: ${currentVersion}`);
    console.log(`Updating agentv using ${pm}...\n`);

    const result = await performSelfUpdate({ pm, currentVersion });

    if (!result.success) {
      console.error('\nUpdate failed.');
      process.exit(1);
    }

    if (result.newVersion) {
      console.log(`\nUpdate complete: ${currentVersion} → ${result.newVersion}`);
    } else {
      console.log('\nUpdate complete.');
    }
  },
});

export const selfCommand = subcommands({
  name: 'self',
  description: 'Manage the agentv installation',
  cmds: {
    update: updateCommand,
  },
});
