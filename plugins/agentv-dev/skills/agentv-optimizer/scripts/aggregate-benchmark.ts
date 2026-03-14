#!/usr/bin/env bun
/**
 * aggregate-benchmark.ts
 *
 * Aggregates pass-rate and timing metrics from benchmark artifacts.
 * Thin CLI entrypoint that calls src/aggregate-benchmark.ts helper.
 */

import { aggregateBenchmarks } from '../src/aggregate-benchmark.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      'Usage: bun scripts/aggregate-benchmark.ts --benchmark <path> --timing <path> [--results <path>]',
    );
    process.exit(1);
  }

  let benchmarkPath: string | null = null;
  let timingPath: string | null = null;
  let resultsPath: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--benchmark' && i + 1 < args.length) {
      benchmarkPath = args[i + 1];
      i++;
    } else if (args[i] === '--timing' && i + 1 < args.length) {
      timingPath = args[i + 1];
      i++;
    } else if (args[i] === '--results' && i + 1 < args.length) {
      resultsPath = args[i + 1];
      i++;
    }
  }

  if (!benchmarkPath || !timingPath) {
    console.error('Error: --benchmark and --timing are required');
    process.exit(1);
  }

  const summary = aggregateBenchmarks({
    benchmarkPath,
    timingPath,
    resultsPath,
  });

  console.log(JSON.stringify(summary, null, 2));
}

main();
