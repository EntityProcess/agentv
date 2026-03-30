import { command, number, option, optional, restPositionals, string } from 'cmd-ts';

import { formatSummary, isTTY } from './format-output.js';
import { validateFiles } from './validate-files.js';

async function runValidateCommand(
  paths: readonly string[],
  maxWarnings: number | undefined,
): Promise<void> {
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

  // Fail if warning count exceeds --max-warnings threshold
  if (maxWarnings !== undefined) {
    const warningCount = summary.results.reduce(
      (count, r) => count + r.errors.filter((e) => e.severity === 'warning').length,
      0,
    );
    if (warningCount > maxWarnings) {
      console.error(
        `Found ${warningCount} warning${warningCount === 1 ? '' : 's'} (max allowed: ${maxWarnings})`,
      );
      process.exit(1);
    }
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
    maxWarnings: option({
      type: optional(number),
      long: 'max-warnings',
      description: 'Maximum number of warnings allowed before failing (e.g., --max-warnings 0)',
    }),
  },
  handler: async ({ paths, maxWarnings }) => {
    try {
      await runValidateCommand(paths, maxWarnings);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
