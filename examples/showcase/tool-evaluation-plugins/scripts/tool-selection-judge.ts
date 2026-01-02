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
 *       script: bun run scripts/tool-selection-judge.ts
 *
 * Input (stdin JSON):
 *   - question: The user's task/question
 *   - expectedOutcome: Description of expected behavior
 *   - outputMessages: Array of messages including tool calls
 *   - traceSummary: Summary of tool usage
 *
 * Output (stdout JSON):
 *   - score: 0.0-1.0 (1.0 = all tools appropriate, 0.0 = all inappropriate)
 *   - hits: List of appropriate tool selections
 *   - misses: List of missing or inappropriate tools
 *   - reasoning: Explanation of the evaluation
 */

interface ToolCall {
  tool: string;
  input?: unknown; // Tool input arguments
  output?: unknown; // Tool output result
  id?: string;
  timestamp?: string;
}

interface OutputMessage {
  role: string;
  content?: unknown;
  toolCalls?: ToolCall[];
  timestamp?: string;
}

interface TraceSummary {
  eventCount: number;
  toolNames: string[];
  toolCallsByName: Record<string, number>;
  errorCount: number;
  tokenUsage?: { input: number; output: number; cached?: number };
  costUsd?: number;
  durationMs?: number;
}

interface EvalInput {
  question?: string;
  expectedOutcome?: string;
  outputMessages?: OutputMessage[];
  traceSummary?: TraceSummary;
}

interface EvalOutput {
  score: number;
  hits: string[];
  misses: string[];
  reasoning: string;
}

interface ExtractedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractToolCalls(messages: OutputMessage[]): ExtractedToolCall[] {
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

function evaluateToolSelection(
  question: string,
  expectedOutcome: string,
  toolCalls: ExtractedToolCall[],
): EvalOutput {
  const hits: string[] = [];
  const misses: string[] = [];

  // Extract keywords from question and expected outcome
  const taskText = `${question} ${expectedOutcome}`.toLowerCase();

  // Define tool-to-task mappings (customize for your domain)
  const toolTaskMappings: Record<string, string[]> = {
    search: ['find', 'search', 'look', 'query', 'discover'],
    fetch: ['get', 'retrieve', 'fetch', 'download', 'load'],
    read: ['read', 'open', 'view', 'examine', 'inspect'],
    write: ['write', 'save', 'create', 'output', 'generate'],
    analyze: ['analyze', 'process', 'compute', 'calculate'],
    validate: ['check', 'validate', 'verify', 'confirm'],
  };

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

  const reasoning =
    `Evaluated ${actualTools.size} tool(s) against task requirements. ` +
    `${hits.length} appropriate, ${misses.length} issues found.`;

  return {
    score: Math.round(score * 100) / 100,
    hits: hits.slice(0, 4), // Cap at 4 per contract
    misses: misses.slice(0, 4),
    reasoning,
  };
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    const inputData = JSON.parse(stdin) as EvalInput;

    const question = inputData.question ?? '';
    const expectedOutcome = inputData.expectedOutcome ?? '';
    const outputMessages = inputData.outputMessages ?? [];

    const toolCalls = extractToolCalls(outputMessages);

    const result = evaluateToolSelection(question, expectedOutcome, toolCalls);

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const errorResult: EvalOutput = {
      score: 0,
      hits: [],
      misses: [`Evaluator error: ${error instanceof Error ? error.message : String(error)}`],
      reasoning: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
    console.log(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

main();
