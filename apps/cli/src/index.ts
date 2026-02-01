import { binary, run, subcommands } from 'cmd-ts';

import { compareCommand } from './commands/compare/index.js';
import { convertCommand } from './commands/convert/index.js';
import { evalCommand } from './commands/eval/index.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { selfCommand } from './commands/self/index.js';
import { validateCommand } from './commands/validate/index.js';
import packageJson from '../package.json' with { type: 'json' };

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
    self: selfCommand,
    validate: validateCommand,
  },
});

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await run(binary(app), argv);
}
