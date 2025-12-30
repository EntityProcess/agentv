import { readFileSync } from 'node:fs';
import { binary, run, subcommands } from 'cmd-ts';

import { convertCommand } from './commands/convert/index.js';
import { evalCommand } from './commands/eval/index.js';
import { generateCommand } from './commands/generate/index.js';
import { initCmdTsCommand } from './commands/init/index.js';
import { validateCommand } from './commands/validate/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const app = subcommands({
  name: 'agentv',
  description: 'AgentV CLI',
  version: packageJson.version,
  cmds: {
    convert: convertCommand,
    eval: evalCommand,
    generate: generateCommand,
    init: initCmdTsCommand,
    validate: validateCommand,
  },
});

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await run(binary(app), argv);
}
