import path from 'node:path';
import { command, positional, string } from 'cmd-ts';

import { aggregateRunDir } from '../artifact-writer.js';

export const evalAggregateCommand = command({
  name: 'aggregate',
  description:
    'Recompute benchmark.json and timing.json from a run directory. Deduplicates by (test_id, target), keeping the last entry.',
  args: {
    runDir: positional({
      type: string,
      displayName: 'run-dir',
      description: 'Path to a run directory containing index.jsonl',
    }),
  },
  handler: async (args) => {
    const runDir = path.resolve(args.runDir);
    const { benchmarkPath, timingPath, testCount, targetCount } = await aggregateRunDir(runDir);
    console.log(`Aggregated ${testCount} test result(s) across ${targetCount} target(s)`);
    console.log(`  Benchmark: ${benchmarkPath}`);
    console.log(`  Timing:    ${timingPath}`);
  },
});
