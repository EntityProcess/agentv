#!/usr/bin/env bun
/**
 * Mock Agent CLI for {{ tool_calls }} template variable demo.
 *
 * Simulates an agent that invokes skills and tools, returning tool call data
 * in the output. Used to demonstrate LLM grader assertions that inspect
 * tool calls via the {{ tool_calls }} template variable.
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
}

interface Message {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

interface AgentResponse {
  output: Message[];
}

function generateResponse(prompt: string): AgentResponse {
  const lower = prompt.toLowerCase();

  // Scenario 1: Deploy request → triggers deploy skill
  if (lower.includes('deploy')) {
    return {
      output: [
        {
          role: 'assistant',
          content: 'Deployment initiated for payments-api to production.',
          tool_calls: [
            {
              tool: 'Skill',
              input: { skill: 'acme-deploy', args: '--service payments-api --env production' },
            },
            { tool: 'Bash', input: { command: 'kubectl rollout status deployment/payments-api' } },
          ],
        },
      ],
    };
  }

  // Scenario 2: Code review → triggers review-pr skill
  if (lower.includes('review') || lower.includes('pull request')) {
    return {
      output: [
        {
          role: 'assistant',
          content: 'I reviewed the pull request and found no issues.',
          tool_calls: [
            { tool: 'Skill', input: { skill: 'review-pr', args: '42' } },
            { tool: 'Read', input: { file_path: '/src/auth.ts' } },
            { tool: 'Read', input: { file_path: '/src/auth.test.ts' } },
          ],
        },
      ],
    };
  }

  // Scenario 3: File editing without skill invocation
  if (lower.includes('fix') || lower.includes('bug')) {
    return {
      output: [
        {
          role: 'assistant',
          content: 'Fixed the null pointer bug in auth.ts.',
          tool_calls: [
            { tool: 'Read', input: { file_path: '/src/auth.ts' } },
            { tool: 'Edit', input: { file_path: '/src/auth.ts' } },
            { tool: 'Bash', input: { command: 'npm test' } },
          ],
        },
      ],
    };
  }

  // Default: no tools
  return {
    output: [{ role: 'assistant', content: 'I processed your request.' }],
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

  if (!values.prompt || !values.output) {
    console.error('Error: --prompt and --output are required');
    process.exit(1);
  }

  const response = generateResponse(values.prompt);
  writeFileSync(values.output, JSON.stringify(response, null, 2));

  const firstMessage = response.output[0];
  if (firstMessage) {
    console.log(firstMessage.content);
  }
}

main();
