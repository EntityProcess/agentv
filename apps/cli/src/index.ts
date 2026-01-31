import { readFileSync } from 'node:fs';
import { binary, run, subcommands } from 'cmd-ts';

import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { evalCommand } from './commands/eval/index.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { validateCommand } from './commands/validate/index.js';
import { workspaceCommand } from './commands/workspace/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    compare: compareCommand,
    convert: convertCommand,
    eval: evalCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    validate: validateCommand,
    workspace: workspaceCommand,
  },
});

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await run(binary(app), argv);
}
