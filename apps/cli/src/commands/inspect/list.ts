import { command, number, oneOf, option, optional, string } from 'cmd-ts';
import { toSnakeCaseDeep } from '../../utils/case-conversion.js';
import {
  type ResultFileMeta,
  c,
  formatScore,
  formatSize,
  listResultFiles,
  padLeft,
  padRight,
} from './utils.js';

function formatListTable(metas: ResultFileMeta[]): string {
  const lines: string[] = [];

  if (metas.length === 0) {
    lines.push(`${c.yellow}No run workspaces found in .agentv/results/runs/${c.reset}`);
    lines.push(`${c.dim}Run an evaluation first: agentv run <eval-file>${c.reset}`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`${c.bold}Evaluation Runs${c.reset} ${c.dim}(.agentv/results/runs/)${c.reset}`);
  lines.push('');

  // Column widths
  const maxFileLen = Math.max(4, ...metas.map((m) => m.filename.length));

  // Header
  const header = `  ${padRight('File', maxFileLen)}  ${padLeft('Tests', 5)}  ${padLeft('Pass', 5)}  ${padLeft('Score', 6)}  ${padLeft('Size', 7)}  Timestamp`;
  lines.push(`${c.dim}${header}${c.reset}`);
  lines.push(
    `${c.dim}  ${'─'.repeat(maxFileLen)}  ${'─'.repeat(5)}  ${'─'.repeat(5)}  ${'─'.repeat(6)}  ${'─'.repeat(7)}  ${'─'.repeat(24)}${c.reset}`,
  );

  for (const meta of metas) {
    const passColor = meta.passRate >= 1.0 ? c.green : meta.passRate >= 0.5 ? c.yellow : c.red;
    const scoreColor = meta.avgScore >= 0.9 ? c.green : meta.avgScore >= 0.5 ? c.yellow : c.red;

    const row = `  ${padRight(meta.filename, maxFileLen)}  ${padLeft(String(meta.testCount), 5)}  ${padLeft(`${passColor}${formatScore(meta.passRate)}${c.reset}`, 5)}  ${padLeft(`${scoreColor}${formatScore(meta.avgScore)}${c.reset}`, 6)}  ${padLeft(formatSize(meta.sizeBytes), 7)}  ${c.dim}${meta.timestamp}${c.reset}`;
    lines.push(row);
  }

  lines.push('');
  lines.push(
    `${c.dim}${metas.length} run workspace${metas.length !== 1 ? 's' : ''} found${c.reset}`,
  );
  lines.push('');

  return lines.join('\n');
}

export const traceListCommand = command({
  name: 'list',
  description: 'List recent evaluation run workspaces from .agentv/results/runs/',
  args: {
    limit: option({
      type: optional(number),
      long: 'limit',
      short: 'n',
      description: 'Maximum number of results to show (default: all)',
    }),
    format: option({
      type: optional(oneOf(['table', 'json'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default) or json',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ limit, format, dir }) => {
    const cwd = dir ?? process.cwd();
    const outputFormat = format ?? 'table';

    try {
      const metas = listResultFiles(cwd, limit);

      if (outputFormat === 'json') {
        console.log(JSON.stringify(toSnakeCaseDeep(metas), null, 2));
      } else {
        console.log(formatListTable(metas));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
