#!/usr/bin/env bun
/**
 * Mock Tool Agent for tool evaluation plugin demos.
 *
 * This CLI simulates an agent that uses various tools, returning
 * output with tool_calls for trajectory evaluation.
 *
 * Usage:
 *   bun run mock-tool-agent.ts --prompt "..." --output output.json
 *   bun run mock-tool-agent.ts --healthcheck
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
}

interface Message {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface AgentResponse {
  text: string;
  output: Message[];
  token_usage: { input: number; output: number; cached?: number };
  cost_usd: number;
  duration_ms: number;
}

/**
 * Generate response with tool calls based on prompt content.
 */
function generateResponse(prompt: string): AgentResponse {
  const lowerPrompt = prompt.toLowerCase();

  // Scenario 1: Weather/search task - uses search and fetch
  if (lowerPrompt.includes('weather') || lowerPrompt.includes('forecast')) {
    return {
      text: 'The weather in Tokyo is currently 22°C with clear skies. The forecast shows...',
      output: [
        {
          role: 'assistant',
          content: 'Let me search for weather information and fetch the detailed forecast.',
          tool_calls: [
            {
              tool: 'search',
              input: { query: 'Tokyo weather current' },
              output: { results: ['22°C, clear'] },
            },
            {
              tool: 'fetch',
              input: { url: 'https://api.weather.com/tokyo' },
              output: { temp: 22, condition: 'clear' },
            },
          ],
        },
        {
          role: 'assistant',
          content:
            'The weather in Tokyo is currently 22°C with clear skies. The forecast shows mild temperatures for the week.',
        },
      ],
      token_usage: { input: 120, output: 85 },
      cost_usd: 0.0015,
      duration_ms: 1250,
    };
  }

  // Scenario 2: Simple time request - minimal tool usage
  if (lowerPrompt.includes('time') || lowerPrompt.includes('current')) {
    return {
      text: 'The current time is 14:30 UTC.',
      output: [
        {
          role: 'assistant',
          content: 'The current time is 14:30 UTC.',
          tool_calls: [{ tool: 'get_time', input: {}, output: { time: '14:30 UTC' } }],
        },
      ],
      token_usage: { input: 25, output: 15 },
      cost_usd: 0.0003,
      duration_ms: 350,
    };
  }

  // Scenario 3: Data analysis - uses search, validate, process in order
  if (
    lowerPrompt.includes('analyze') ||
    lowerPrompt.includes('sales') ||
    lowerPrompt.includes('data')
  ) {
    return {
      text: 'Quarterly sales analysis complete. Key findings: Revenue up 15%, strong Q3 performance.',
      output: [
        {
          role: 'assistant',
          content: 'Let me analyze the quarterly sales data.',
          tool_calls: [
            {
              tool: 'search',
              input: { query: 'sales Q1-Q4' },
              output: { data: [100, 120, 150, 140] },
            },
            {
              tool: 'validate',
              input: { data: [100, 120, 150, 140] },
              output: { valid: true, issues: [] },
            },
            {
              tool: 'process',
              input: { operation: 'aggregate', data: [100, 120, 150, 140] },
              output: { total: 510, avg: 127.5 },
            },
          ],
        },
        {
          role: 'assistant',
          content:
            'Quarterly sales analysis complete. Key findings: Revenue up 15%, strong Q3 performance.',
        },
      ],
      token_usage: { input: 280, output: 195 },
      cost_usd: 0.0032,
      duration_ms: 2100,
    };
  }

  // Scenario 4: Document summary - for pairwise comparison
  if (
    lowerPrompt.includes('summarize') ||
    lowerPrompt.includes('manual') ||
    lowerPrompt.includes('document')
  ) {
    return {
      text: 'Here is a summary of the user manual:\n1. Installation: Follow the setup wizard\n2. Configuration: Edit settings.json\n3. Usage: Run the main command',
      output: [
        {
          role: 'assistant',
          content: 'I will retrieve and summarize the document.',
          tool_calls: [
            { tool: 'fetch', input: { path: '/docs/manual.md' }, output: { content: '...' } },
            {
              tool: 'process',
              input: { operation: 'summarize', content: '...' },
              output: { summary: '...' },
            },
          ],
        },
        {
          role: 'assistant',
          content:
            'Here is a summary of the user manual:\n1. Installation: Follow the setup wizard\n2. Configuration: Edit settings.json\n3. Usage: Run the main command',
        },
      ],
      token_usage: { input: 450, output: 280 },
      cost_usd: 0.0048,
      duration_ms: 2800,
    };
  }

  // Default: general response with minimal tools
  return {
    text: 'I processed your request.',
    output: [
      {
        role: 'assistant',
        content: 'I processed your request.',
        tool_calls: [{ tool: 'process', input: { request: prompt }, output: { status: 'done' } }],
      },
    ],
    token_usage: { input: 50, output: 25 },
    cost_usd: 0.0005,
    duration_ms: 500,
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
