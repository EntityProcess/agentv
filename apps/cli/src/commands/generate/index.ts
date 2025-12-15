import type { Command } from 'commander';

import { generateRubricsCommand } from './rubrics.js';

export function registerGenerateCommand(program: Command): void {
  const generate = program
    .command('generate')
    .description('Generate evaluation artifacts');

  generate
    .command('rubrics <file>')
    .description('Generate rubrics from expected_outcome in YAML eval file')
    .option('-t, --target <target>', 'Override target for rubric generation (default: file target or openai:gpt-4o)')
    .option('-v, --verbose', 'Show detailed progress')
    .action(async (file: string, options: { target?: string; verbose?: boolean }) => {
      try {
        await generateRubricsCommand({
          file,
          target: options.target,
          verbose: options.verbose,
        });
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
