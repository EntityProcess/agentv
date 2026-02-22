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
import { trimCommand } from './commands/trim/index.js';
import { validateCommand } from './commands/validate/index.js';

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
    trim: trimCommand,
    validate: validateCommand,
  },
});

/** Known prompt eval sub-subcommands used for default insertion. */
const PROMPT_EVAL_SUBCOMMANDS = new Set(['overview', 'input', 'judge']);

/**
 * Preprocess argv for default subcommand insertion and convenience aliases:
 * 1. `agentv prompt file.yaml` → `agentv prompt eval overview file.yaml`
 * 2. `agentv prompt eval file.yaml` → `agentv prompt eval overview file.yaml`
 * 3. `--eval-id` → `--test-id` (convenience alias)
 */
export function preprocessArgv(argv: string[]): string[] {
  const result = [...argv];

  // Insert default prompt subcommands:
  //   `agentv prompt file.yaml` → `agentv prompt eval overview file.yaml`
  //   `agentv prompt eval file.yaml` → `agentv prompt eval overview file.yaml`
  const promptIndex = result.indexOf('prompt');
  if (promptIndex !== -1) {
    const nextArg = result[promptIndex + 1];
    if (nextArg !== 'eval') {
      result.splice(promptIndex + 1, 0, 'eval');
    }

    const evalIdx = promptIndex + 1;
    const subSubArg = result[evalIdx + 1];
    if (subSubArg === undefined || !PROMPT_EVAL_SUBCOMMANDS.has(subSubArg)) {
      result.splice(evalIdx + 1, 0, 'overview');
    }
  }

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
  const processedArgv = preprocessArgv(argv);
  await run(binary(app), processedArgv);
}
