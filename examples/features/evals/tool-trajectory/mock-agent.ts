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

interface TraceEvent {
  type: 'tool_call' | 'tool_result' | 'model_step' | 'message' | 'error';
  timestamp: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
}

interface AgentResponse {
  text: string;
  trace: TraceEvent[];
}

function createTimestamp(offsetSeconds: number): string {
  const date = new Date('2024-01-01T00:00:00Z');
  date.setSeconds(date.getSeconds() + offsetSeconds);
  return date.toISOString();
}

function createToolCall(
  id: string,
  name: string,
  input: unknown,
  offsetSeconds: number,
): TraceEvent {
  return {
    type: 'tool_call',
    timestamp: createTimestamp(offsetSeconds),
    id,
    name,
    input,
  };
}

function createToolResult(
  id: string,
  name: string,
  output: unknown,
  offsetSeconds: number,
): TraceEvent {
  return {
    type: 'tool_result',
    timestamp: createTimestamp(offsetSeconds),
    id,
    name,
    output,
  };
}

/**
 * Generate trace based on the prompt content.
 * Different prompts trigger different tool sequences to demonstrate various evaluator modes.
 */
function generateResponse(prompt: string): AgentResponse {
  const lowerPrompt = prompt.toLowerCase();

  // Scenario 1: Research task - uses knowledgeSearch and documentRetrieve
  if (lowerPrompt.includes('research') || lowerPrompt.includes('search')) {
    return {
      text: 'Based on my research of the knowledge base, here is my analysis of REST vs GraphQL APIs...',
      trace: [
        createToolCall('call-1', 'knowledgeSearch', { query: 'REST API characteristics' }, 0),
        createToolResult('call-1', 'knowledgeSearch', 'REST uses HTTP methods...', 1),
        createToolCall('call-2', 'knowledgeSearch', { query: 'GraphQL characteristics' }, 2),
        createToolResult('call-2', 'knowledgeSearch', 'GraphQL uses single endpoint...', 3),
        createToolCall('call-3', 'documentRetrieve', { docId: 'api-comparison' }, 4),
        createToolResult('call-3', 'documentRetrieve', 'Detailed comparison document...', 5),
      ],
    };
  }

  // Scenario 2: Data pipeline - uses fetchData, validateSchema, transformData, saveResults
  if (
    lowerPrompt.includes('process') ||
    lowerPrompt.includes('data') ||
    lowerPrompt.includes('pipeline')
  ) {
    return {
      text: 'Data processing complete. Validated 1,247 records, transformed and saved successfully.',
      trace: [
        createToolCall('call-1', 'fetchData', { endpoint: '/api/customers' }, 0),
        createToolResult('call-1', 'fetchData', '[...1247 records...]', 1),
        createToolCall('call-2', 'validateSchema', { schema: 'customer-v2' }, 2),
        createToolResult('call-2', 'validateSchema', 'All records valid', 3),
        createToolCall('call-3', 'transformData', { format: 'normalized' }, 4),
        createToolResult('call-3', 'transformData', 'Transformed 1247 records', 5),
        createToolCall('call-4', 'saveResults', { destination: 'processed_customers' }, 6),
        createToolResult('call-4', 'saveResults', 'Saved successfully', 7),
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
      text: 'Authentication successful. Token generated for user.',
      trace: [
        createToolCall('call-1', 'checkCredentials', { user: 'user@example.com' }, 0),
        createToolResult('call-1', 'checkCredentials', 'Credentials valid', 1),
        createToolCall('call-2', 'generateToken', { userId: 'user@example.com', ttl: 3600 }, 2),
        createToolResult('call-2', 'generateToken', 'token_abc123...', 3),
        createToolCall('call-3', 'auditLog', { event: 'login', user: 'user@example.com' }, 4),
        createToolResult('call-3', 'auditLog', 'Logged', 5),
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
      text: `Based on the current system metrics:
- CPU Usage: 45% average across all cores
- Memory Usage: 6.2GB / 16GB (38.75%)
The system is operating within normal parameters.`,
      trace: [
        createToolCall('call-1', 'getCpuMetrics', { server: 'prod-1' }, 0),
        createToolResult('call-1', 'getCpuMetrics', '45%', 1),
        createToolCall('call-2', 'getMemoryMetrics', { server: 'prod-1' }, 2),
        createToolResult('call-2', 'getMemoryMetrics', '6.2GB / 16GB', 3),
      ],
    };
  }

  // Scenario 5: Branch deactivation - uses semanticSearch multiple times
  if (lowerPrompt.includes('deactivate') && lowerPrompt.includes('branch')) {
    return {
      text: 'To deactivate a branch: 1) Ensure you have admin permissions, 2) Resolve pending transactions, 3) Navigate to Settings > Branches and click Deactivate.',
      trace: [
        createToolCall('call-1', 'semanticSearch', { query: 'branch deactivation process' }, 0),
        createToolResult(
          'call-1',
          'semanticSearch',
          { results: ['Navigate to Settings > Branches...'] },
          1,
        ),
        createToolCall('call-2', 'semanticSearch', { query: 'branch permissions requirements' }, 2),
        createToolResult(
          'call-2',
          'semanticSearch',
          { results: ['Only admins can deactivate branches...'] },
          3,
        ),
        createToolCall(
          'call-3',
          'semanticSearch',
          { query: 'branch deactivation prerequisites' },
          4,
        ),
        createToolResult(
          'call-3',
          'semanticSearch',
          { results: ['Resolve pending transactions first...'] },
          5,
        ),
      ],
    };
  }

  // Default: generic response with no tools
  return {
    text: 'I processed your request.',
    trace: [],
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
  console.log(response.text);
}

main();
