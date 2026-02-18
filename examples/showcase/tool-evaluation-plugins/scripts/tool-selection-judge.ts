#!/usr/bin/env bun
/**
 * Tool Selection Evaluator - Code Judge Plugin
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
 *       type: code_judge
 *       script: ["bun", "run", "scripts/tool-selection-judge.ts"]
 */
import { type OutputMessage, defineCodeJudge } from '@agentv/eval';

interface ExtractedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractToolCalls(messages: readonly OutputMessage[]): ExtractedToolCall[] {
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

export default defineCodeJudge(({ question, criteria, outputMessages }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  const toolCalls = extractToolCalls(outputMessages ?? []);

  // Extract keywords from question and expected outcome
  const taskText = `${question} ${criteria}`.toLowerCase();

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
      hits: [],
      misses: ['No tools were called'],
      reasoning: 'Agent did not use any tools. Expected at least some tool usage.',
    };
  }

  // Check for appropriate selections
  for (const tool of actualTools) {
    const toolLower = tool.toLowerCase();
    const isRelevant = [...expectedTools].some(
      (expected) => toolLower.includes(expected) || expected.includes(toolLower),
    );
    if (isRelevant || expectedTools.size === 0) {
      hits.push(`Tool '${tool}' appears relevant to task`);
    } else {
      misses.push(`Tool '${tool}' may not be needed for this task`);
    }
  }

  // Check for missing expected tools
  for (const expected of expectedTools) {
    if (![...actualTools].some((t) => t.toLowerCase().includes(expected))) {
      misses.push(`Expected a '${expected}'-type tool but none used`);
    }
  }

  // Calculate score
  const totalChecks = hits.length + misses.length;
  const score = totalChecks > 0 ? hits.length / totalChecks : 0.5;

  return {
    score: Math.round(score * 100) / 100,
    hits: hits.slice(0, 4),
    misses: misses.slice(0, 4),
    reasoning: `Evaluated ${actualTools.size} tool(s) against task requirements. ${hits.length} appropriate, ${misses.length} issues found.`,
  };
});
