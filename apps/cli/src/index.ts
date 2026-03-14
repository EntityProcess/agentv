import { binary, run, subcommands } from 'cmd-ts';

import packageJson from '../package.json' with { type: 'json' };
import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { createCommand } from './commands/create/index.js';
import { evalPromptCommand } from './commands/eval/commands/prompt/index.js';
import { evalRunCommand } from './commands/eval/commands/run.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { selfCommand } from './commands/self/index.js';
import { traceCommand } from './commands/trace/index.js';
import { trimCommand } from './commands/trim/index.js';
import { validateCommand } from './commands/validate/index.js';
import { workspaceCommand } from './commands/workspace/index.js';
import { getUpdateNotice } from './update-check.js';

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    eval: evalRunCommand,
    prompt: evalPromptCommand,
    compare: compareCommand,
    convert: convertCommand,
    create: createCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    self: selfCommand,
    trace: traceCommand,
    trim: trimCommand,
    validate: validateCommand,
    workspace: workspaceCommand,
  },
});

/**
 * Preprocess argv for convenience aliases:
 * `--eval-id` → `--test-id`
 */
export function preprocessArgv(argv: string[]): string[] {
  const result = [...argv];

  // Rewrite --eval-id → --test-id (convenience alias)
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '--eval-id') {
      result[i] = '--test-id';
    } else if (result[i].startsWith('--eval-id=')) {
      result[i] = `--test-id=${result[i].slice('--eval-id='.length)}`;
    }
  }

  return result;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  // Kick off update check: reads from local cache (fast), spawns a detached
  // child to refresh if stale. The notice is printed on process exit so it
  // appears after command output, even if the command calls process.exit().
  let updateNotice: string | null = null;
  process.on('exit', () => {
    if (updateNotice) process.stderr.write(`\n${updateNotice}\n`);
  });
  getUpdateNotice(packageJson.version).then((n) => {
    updateNotice = n;
  });

  const processedArgv = preprocessArgv(argv);
  await run(binary(app), processedArgv);
}
