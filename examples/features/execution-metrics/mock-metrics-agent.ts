#!/usr/bin/env bun
/**
 * Mock Agent CLI for execution metrics demos.
 *
 * This CLI simulates an agent that returns execution metrics:
 * - token_usage: { input, output, cached }
 * - cost_usd: API cost
 * - duration_ms: execution time
 *
 * Usage:
 *   bun run mock-metrics-agent.ts --prompt "..." --output output.json
 *   bun run mock-metrics-agent.ts --healthcheck
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
}

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
}

interface OutputMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface AgentResponse {
  text: string;
  output_messages: OutputMessage[];
  token_usage: TokenUsage;
  cost_usd: number;
  duration_ms: number;
}

/**
 * Generate response with metrics based on prompt content.
 */
function generateResponse(prompt: string): AgentResponse {
  const lowerPrompt = prompt.toLowerCase();

  // Scenario 1: Simple query - low token usage
  if (lowerPrompt.includes('simple') || lowerPrompt.includes('hello')) {
    return {
      text: 'Hello! How can I help you today?',
      output_messages: [
        {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
      ],
      token_usage: { input: 15, output: 12 },
      cost_usd: 0.0001,
      duration_ms: 245,
    };
  }

  // Scenario 2: Research task - higher token usage with tools
  if (lowerPrompt.includes('research') || lowerPrompt.includes('analyze')) {
    return {
      text: 'Based on my research, here are the key findings about the topic...',
      output_messages: [
        {
          role: 'assistant',
          content: 'Based on my research, here are the key findings about the topic...',
          tool_calls: [
            { tool: 'search', input: { query: 'topic analysis' } },
            { tool: 'summarize', input: { text: '...' } },
          ],
        },
      ],
      token_usage: { input: 450, output: 380, cached: 120 },
      cost_usd: 0.0042,
      duration_ms: 3420,
    };
  }

  // Scenario 3: Code generation - expensive operation
  if (lowerPrompt.includes('code') || lowerPrompt.includes('implement')) {
    return {
      text: 'Here is the implementation:\n\n```typescript\nfunction example() {\n  return "Hello";\n}\n```',
      output_messages: [
        {
          role: 'assistant',
          content:
            'Here is the implementation:\n\n```typescript\nfunction example() {\n  return "Hello";\n}\n```',
          tool_calls: [
            { tool: 'Read', input: { path: 'src/index.ts' } },
            { tool: 'Edit', input: { path: 'src/example.ts', content: '...' } },
          ],
        },
      ],
      token_usage: { input: 1200, output: 850 },
      cost_usd: 0.0125,
      duration_ms: 8500,
    };
  }

  // Scenario 4: Inefficient agent - too many tool calls (for testing efficiency checks)
  if (lowerPrompt.includes('inefficient') || lowerPrompt.includes('wasteful')) {
    return {
      text: 'I completed the task after extensive exploration.',
      output_messages: [
        {
          role: 'assistant',
          content: 'I completed the task after extensive exploration.',
          tool_calls: [
            { tool: 'search', input: { query: 'step 1' } },
            { tool: 'search', input: { query: 'step 2' } },
            { tool: 'search', input: { query: 'step 3' } },
            { tool: 'search', input: { query: 'step 4' } },
            { tool: 'search', input: { query: 'step 5' } },
            { tool: 'search', input: { query: 'step 6' } },
            { tool: 'search', input: { query: 'step 7' } },
            { tool: 'search', input: { query: 'step 8' } },
            { tool: 'verify', input: { data: '...' } },
            { tool: 'verify', input: { data: '...' } },
          ],
        },
      ],
      token_usage: { input: 3500, output: 2800 },
      cost_usd: 0.045,
      duration_ms: 25000,
    };
  }

  // Default: moderate usage
  return {
    text: 'I processed your request successfully.',
    output_messages: [
      {
        role: 'assistant',
        content: 'I processed your request successfully.',
      },
    ],
    token_usage: { input: 85, output: 42 },
    cost_usd: 0.0008,
    duration_ms: 890,
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
  console.log(response.text);
}

main();
