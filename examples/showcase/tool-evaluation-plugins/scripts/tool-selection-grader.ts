#!/usr/bin/env bun
/**
 * Tool Selection Evaluator - Code Grader Plugin
 *
 * Evaluates whether the agent selected the RIGHT tools for the task.
 * This is a semantic evaluation that requires understanding task requirements
 * and matching them against available tools.
 *
 * Why this is a plugin (not built-in):
 * - Requires domain-specific knowledge of what tools are "appropriate"
 * - Involves semantic judgment, not just pattern matching
 * - Different projects have different tool selection criteria
 *
 * Usage in eval YAML:
 *   evaluators:
 *     - name: tool-selection
 *       type: code_grader
 *       script: ["bun", "run", "scripts/tool-selection-grader.ts"]
 */
import { type Message, defineCodeGrader } from '@agentv/eval';

interface ExtractedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractToolCalls(messages: readonly Message[]): ExtractedToolCall[] {
  const toolCalls: ExtractedToolCall[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        toolCalls.push({
          tool: call.tool,
          input: (call.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }
  return toolCalls;
}

// Define tool-to-task mappings (customize for your domain)
const toolTaskMappings: Record<string, string[]> = {
  search: ['find', 'search', 'look', 'query', 'discover'],
  fetch: ['get', 'retrieve', 'fetch', 'download', 'load'],
  read: ['read', 'open', 'view', 'examine', 'inspect'],
  write: ['write', 'save', 'create', 'output', 'generate'],
  analyze: ['analyze', 'process', 'compute', 'calculate'],
  validate: ['check', 'validate', 'verify', 'confirm'],
};

export default defineCodeGrader(({ inputText, criteria, output }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  const toolCalls = extractToolCalls(output ?? []);

  // Extract keywords from input and expected outcome
  const taskText = `${inputText} ${criteria}`.toLowerCase();

  // Determine expected tools based on task keywords
  const expectedTools = new Set<string>();
  for (const [tool, keywords] of Object.entries(toolTaskMappings)) {
    if (keywords.some((kw) => taskText.includes(kw))) {
      expectedTools.add(tool);
    }
  }

  // Get actual tools used
  const actualTools = new Set(toolCalls.map((call) => call.tool));

  // Evaluate selection
  if (toolCalls.length === 0) {
    return {
      score: 0,
      assertions: [{ text: 'No tools were called', passed: false }],
    };
  }

  // Check for appropriate selections
  for (const tool of actualTools) {
    const toolLower = tool.toLowerCase();
    const isRelevant = [...expectedTools].some(
      (expected) => toolLower.includes(expected) || expected.includes(toolLower),
    );
    if (isRelevant || expectedTools.size === 0) {
      assertions.push({ text: `Tool '${tool}' appears relevant to task`, passed: true });
    } else {
      assertions.push({ text: `Tool '${tool}' may not be needed for this task`, passed: false });
    }
  }

  // Check for missing expected tools
  for (const expected of expectedTools) {
    if (![...actualTools].some((t) => t.toLowerCase().includes(expected))) {
      assertions.push({ text: `Expected a '${expected}'-type tool but none used`, passed: false });
    }
  }

  // Calculate score
  const passed = assertions.filter((a) => a.passed).length;
  const totalChecks = assertions.length;
  const score = totalChecks > 0 ? passed / totalChecks : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    assertions: assertions.slice(0, 8),
  };
});
