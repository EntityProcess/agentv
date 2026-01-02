#!/usr/bin/env bun
/**
 * Mock Agent CLI for tool_trajectory evaluator demos.
 *
 * This CLI simulates an agent that uses tools and returns trace data.
 * It demonstrates how real agent providers (codex, vscode) would return
 * trace events for tool_trajectory evaluation.
 *
 * Usage:
 *   bun run mock-agent.ts --prompt "..." --output output.json
 *   bun run mock-agent.ts --healthcheck
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

interface ToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
  id?: string;
  timestamp?: string;
}

interface OutputMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface AgentResponse {
  output_messages: OutputMessage[];
}

function createToolCall(name: string, input: unknown, id?: string): ToolCall {
  return {
    tool: name,
    input,
    id,
  };
}

/**
 * Generate response based on the prompt content.
 * Different prompts trigger different tool sequences to demonstrate various evaluator modes.
 */
function generateResponse(prompt: string): AgentResponse {
  const lowerPrompt = prompt.toLowerCase();

  // Scenario 1: Research task - uses knowledgeSearch and documentRetrieve
  if (lowerPrompt.includes('research') || lowerPrompt.includes('search')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content:
            'Based on my research of the knowledge base, here is my analysis of REST vs GraphQL APIs...',
          tool_calls: [
            createToolCall('knowledgeSearch', { query: 'REST API characteristics' }),
            createToolCall('knowledgeSearch', { query: 'GraphQL characteristics' }),
            createToolCall('documentRetrieve', { docId: 'api-comparison' }),
          ],
        },
      ],
    };
  }

  // Scenario 2a: Data loading/transformation - uses load_data, transform, save_data
  // Must be checked BEFORE generic data pipeline to match specific "load" + "customer"/"normalize"
  if (
    lowerPrompt.includes('load') &&
    (lowerPrompt.includes('customer') || lowerPrompt.includes('normalize'))
  ) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'Customer data loaded, normalized, and saved successfully.',
          tool_calls: [
            createToolCall('load_data', { source: 'customers' }),
            createToolCall('transform', { operation: 'normalize' }),
            createToolCall('save_data', { destination: 'output' }),
          ],
        },
      ],
    };
  }

  // Scenario 2b: Data pipeline - uses fetchData, validateSchema, transformData, saveResults
  if (
    lowerPrompt.includes('process') ||
    lowerPrompt.includes('data') ||
    lowerPrompt.includes('pipeline')
  ) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content:
            'Data processing complete. Validated 1,247 records, transformed and saved successfully.',
          tool_calls: [
            createToolCall('fetchData', { endpoint: '/api/customers' }),
            createToolCall('validateSchema', { schema: 'customer-v2' }),
            createToolCall('transformData', { format: 'normalized' }),
            createToolCall('saveResults', { destination: 'processed_customers' }),
          ],
        },
      ],
    };
  }

  // Scenario 3: Authentication - uses checkCredentials, generateToken, auditLog
  if (
    lowerPrompt.includes('auth') ||
    lowerPrompt.includes('login') ||
    lowerPrompt.includes('credential')
  ) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'Authentication successful. Token generated for user.',
          tool_calls: [
            createToolCall('checkCredentials', { user: 'user@example.com' }),
            createToolCall('generateToken', { userId: 'user@example.com', ttl: 3600 }),
            createToolCall('auditLog', { event: 'login', user: 'user@example.com' }),
          ],
        },
      ],
    };
  }

  // Scenario 4: System metrics - uses getCpuMetrics, getMemoryMetrics
  if (
    lowerPrompt.includes('metric') ||
    lowerPrompt.includes('cpu') ||
    lowerPrompt.includes('memory')
  ) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: `Based on the current system metrics:
- CPU Usage: 45% average across all cores
- Memory Usage: 6.2GB / 16GB (38.75%)
The system is operating within normal parameters.`,
          tool_calls: [
            createToolCall('getCpuMetrics', { server: 'prod-1' }),
            createToolCall('getMemoryMetrics', { server: 'prod-1' }),
          ],
        },
      ],
    };
  }

  // Scenario 5: Branch deactivation - uses semanticSearch multiple times
  if (lowerPrompt.includes('deactivate') && lowerPrompt.includes('branch')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content:
            'To deactivate a branch: 1) Ensure you have admin permissions, 2) Resolve pending transactions, 3) Navigate to Settings > Branches and click Deactivate.',
          tool_calls: [
            createToolCall('semanticSearch', { query: 'branch deactivation process' }),
            createToolCall('semanticSearch', { query: 'branch permissions requirements' }),
            createToolCall('semanticSearch', { query: 'branch deactivation prerequisites' }),
          ],
        },
      ],
    };
  }

  // Scenario 6: Weather query - uses search and get_weather with exact args
  if (lowerPrompt.includes('weather')) {
    return {
      output_messages: [
        {
          role: 'assistant',
          content: 'The weather in Paris is currently sunny with a high of 22°C.',
          tool_calls: [
            createToolCall('search', { query: 'weather Paris' }),
            createToolCall('get_weather', { location: 'Paris' }),
          ],
        },
      ],
    };
  }

  // Default: generic response with no tools
  return {
    output_messages: [
      {
        role: 'assistant',
        content: 'I processed your request.',
      },
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

  // Healthcheck mode
  if (values.healthcheck) {
    console.log('OK');
    process.exit(0);
  }

  // Validate required args
  if (!values.prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  if (!values.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  // Generate response based on prompt
  const response = generateResponse(values.prompt);

  // Write output to file
  writeFileSync(values.output, JSON.stringify(response, null, 2));

  // Also output the text to stdout for logging
  const firstMessage = response.output_messages[0];
  if (firstMessage) {
    console.log(firstMessage.content);
  }
}

main();
