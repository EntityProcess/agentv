import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { command, flag, subcommands } from 'cmd-ts';

const packageJson = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
);

/**
 * Detect package manager from the script path.
 * If the path contains '.bun', it was installed via bun; otherwise assume npm.
 */
export function detectPackageManagerFromPath(scriptPath: string): 'bun' | 'npm' {
  if (scriptPath.includes('.bun')) {
    return 'bun';
  }
  return 'npm';
}

function detectPackageManager(): 'bun' | 'npm' {
  return detectPackageManagerFromPath(process.argv[1] ?? '');
}

function runCommand(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data);
      stdout += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout }));
  });
}

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

    const args = pm === 'npm' ? ['install', '-g', 'agentv@latest'] : ['add', '-g', 'agentv@latest'];

    try {
      const result = await runCommand(pm, args);

      if (result.exitCode !== 0) {
        console.error('\nUpdate failed.');
        process.exit(1);
      }

      // Get new version
      let newVersion: string | undefined;
      try {
        const versionResult = await runCommand('agentv', ['--version']);
        newVersion = versionResult.stdout.trim();
      } catch {
        // Ignore - version check is best-effort
      }

      if (newVersion) {
        console.log(`\nUpdate complete: ${currentVersion} → ${newVersion}`);
      } else {
        console.log('\nUpdate complete.');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT') || error.message.includes('not found')) {
          const alternative = pm === 'npm' ? 'bun' : 'npm';
          console.error(`Error: ${pm} not found. Try using --${alternative} flag.`);
        } else {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      }
      throw error;
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
