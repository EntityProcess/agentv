#!/usr/bin/env bun
/**
 * Mock Agent CLI for latency assertion demos.
 *
 * Returns tool calls with duration_ms to demonstrate
 * per-step latency validation in tool_trajectory evaluator.
 *
 * Usage:
 *   bun run mock-latency-agent.ts --prompt "..." --output output.json
 *   bun run mock-latency-agent.ts --healthcheck
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

interface ToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
  duration_ms: number;
}

interface OutputMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface AgentResponse {
  output_messages: OutputMessage[];
}

function generateResponse(prompt: string): AgentResponse {
  const lowerPrompt = prompt.toLowerCase();

  // Scenario: Read file (fast operation)
  if (lowerPrompt.includes('read') || lowerPrompt.includes('config')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'Here is the config file content: { "debug": false }',
          tool_calls: [
            { tool: 'Read', input: { path: 'config.json' }, output: '{ "debug": false }', duration_ms: 45 },
          ],
        },
      ],
    };
  }

  // Scenario: Large file read (slow operation)
  if (lowerPrompt.includes('large')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'Loaded the large file.',
          tool_calls: [
            { tool: 'Read', input: { path: 'large-file.json' }, output: '...', duration_ms: 150 },
          ],
        },
      ],
    };
  }

  // Scenario: Data pipeline (mixed durations)
  if (lowerPrompt.includes('process') || lowerPrompt.includes('data') || lowerPrompt.includes('customer')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'Data pipeline completed successfully.',
          tool_calls: [
            { tool: 'fetchData', input: { endpoint: '/api/data' }, duration_ms: 450 },
            { tool: 'validateSchema', input: { schema: 'v2' }, duration_ms: 30 },
            { tool: 'transformData', input: { format: 'normalized' }, duration_ms: 120 },
            { tool: 'saveResults', input: { dest: 'output' }, duration_ms: 85 },
          ],
        },
      ],
    };
  }

  // Scenario: Authentication (fast operations)
  if (lowerPrompt.includes('auth') || lowerPrompt.includes('credential')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'User authenticated successfully.',
          tool_calls: [
            { tool: 'checkCredentials', input: { user: 'admin' }, duration_ms: 35 },
            { tool: 'generateToken', input: { ttl: 3600 }, duration_ms: 12 },
            { tool: 'auditLog', input: { event: 'login' }, duration_ms: 80 },
          ],
        },
      ],
    };
  }

  // Scenario: Weather query
  if (lowerPrompt.includes('weather')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'The weather in Paris is 22°C and sunny.',
          tool_calls: [
            { tool: 'search', input: { query: 'weather Paris' }, duration_ms: 280 },
            { tool: 'get_weather', input: { location: 'Paris' }, duration_ms: 450 },
          ],
        },
      ],
    };
  }

  // Default
  return {
    output_messages: [
      { role: 'assistant', content: 'Request processed.' },
    ],
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      prompt: { type: 'string', short: 'p' },
      output: { type: 'string', short: 'o' },
      healthcheck: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.healthcheck) {
    console.log('OK');
    process.exit(0);
  }

  if (!values.prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  if (!values.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  const response = generateResponse(values.prompt);
  writeFileSync(values.output, JSON.stringify(response, null, 2));
  const msg = response.output_messages[0];
  if (msg) console.log(msg.content);
}

main();
