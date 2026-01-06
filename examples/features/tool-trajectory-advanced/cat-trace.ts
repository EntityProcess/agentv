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

type TraceEvent = {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  timestamp?: string;
};

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
    const parsed = JSON.parse(content) as { text?: unknown; trace?: TraceEvent[] };
    const outputPayload = buildOutputPayload(parsed);

    // Write to output file
    writeFileSync(values.output, JSON.stringify(outputPayload, null, 2));

    // Log text to stdout (optional)
    if (outputPayload.text) {
      console.log(outputPayload.text);
    }
  } catch (error) {
    console.error(`Error processing trace file: ${error}`);
    process.exit(1);
  }
}

function buildOutputPayload(parsed: {
  text?: unknown;
  trace?: TraceEvent[];
}): {
  text?: string;
  output_messages?: Array<{
    role: string;
    content?: string;
    tool_calls?: Array<{
      tool: string;
      input?: unknown;
      output?: unknown;
      id?: string;
      timestamp?: string;
    }>;
  }>;
} {
  const text = typeof parsed.text === 'string' ? parsed.text : undefined;

  if (!Array.isArray(parsed.trace) || parsed.trace.length === 0) {
    return { ...(text ? { text } : {}) };
  }

  const toolResults = new Map<string, TraceEvent>();
  for (const event of parsed.trace) {
    if (event?.type === 'tool_result' && event.id) {
      toolResults.set(event.id, event);
    }
  }

  const toolCalls = parsed.trace
    .filter((event) => event?.type === 'tool_call' && event.name)
    .map((event) => {
      const output = event.id ? toolResults.get(event.id)?.output : undefined;
      return {
        tool: event.name as string,
        ...(event.input !== undefined ? { input: event.input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(event.id ? { id: event.id } : {}),
        ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      };
    });

  return {
    ...(text ? { text } : {}),
    output_messages: [
      {
        role: 'assistant',
        ...(text ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ],
  };
}

main();
