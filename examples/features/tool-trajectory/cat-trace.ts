#!/usr/bin/env bun
/**
 * Static Trace CLI.
 *
 * Reads a static trace file and writes it to the output file.
 * Used to demonstrate evaluating pre-existing trace files.
 *
 * Usage:
 *   bun run cat-trace.ts --trace static-trace.json --output output.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

function main(): void {
  const { values } = parseArgs({
    options: {
      trace: { type: 'string' },
      output: { type: 'string', short: 'o' },
      healthcheck: { type: 'boolean' },
      // Accept prompt but ignore it
      prompt: { type: 'string', short: 'p' },
    },
    allowPositionals: true,
  });

  // Healthcheck mode
  if (values.healthcheck) {
    console.log('OK');
    process.exit(0);
  }

  // Validate required args
  if (!values.trace) {
    console.error('Error: --trace is required');
    process.exit(1);
  }

  if (!values.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  try {
    // Read the static trace file
    const content = readFileSync(values.trace, 'utf8');

    // Write to output file
    writeFileSync(values.output, content);

    // Log text to stdout (optional)
    const parsed = JSON.parse(content);
    if (parsed.text) {
      console.log(parsed.text);
    }
  } catch (error) {
    console.error(`Error processing trace file: ${error}`);
    process.exit(1);
  }
}

main();
