import { command, restPositionals, string } from 'cmd-ts';

import { formatSummary, isTTY } from './format-output.js';
import { validateFiles } from './validate-files.js';

async function runValidateCommand(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    console.error('Error: No paths specified. Usage: agentv validate <paths...>');
    process.exit(1);
  }

  const summary = await validateFiles(paths);

  // Output results
  const useColors = isTTY();
  console.log(formatSummary(summary, useColors));

  // Exit with appropriate code
  if (summary.invalidFiles > 0) {
    process.exit(1);
  }
}

export const validateCommand = command({
  name: 'validate',
  description: 'Validate AgentV eval and targets YAML files',
  args: {
    paths: restPositionals({
      type: string,
      displayName: 'paths',
      description: 'Files or directories to validate',
    }),
  },
  handler: async ({ paths }) => {
    try {
      await runValidateCommand(paths);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
