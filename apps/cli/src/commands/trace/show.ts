import { command, flag, oneOf, option, optional, positional, string } from 'cmd-ts';
import {
  type RawMetricsSummary,
  type RawResult,
  c,
  formatCost,
  formatDuration,
  formatNumber,
  formatScore,
  loadResultFile,
} from './utils.js';

/**
 * Render flat metrics summary line (fallback when full output messages not available).
 */
function renderFlatMetrics(metrics: RawMetricsSummary): string {
  const parts: string[] = [];

  if (metrics.tool_names && metrics.tool_names.length > 0) {
    const toolParts = metrics.tool_names.map((name) => {
      const count = metrics.tool_calls_by_name?.[name] ?? 0;
      return count > 1 ? `${name} ×${count}` : name;
    });
    parts.push(`Tools: ${toolParts.join(', ')}`);
  }

  if (metrics.duration_ms !== undefined) {
    parts.push(`Duration: ${formatDuration(metrics.duration_ms)}`);
  }

  if (metrics.token_usage) {
    const total = metrics.token_usage.input + metrics.token_usage.output;
    parts.push(`Tokens: ${formatNumber(total)}`);
  }

  if (metrics.cost_usd !== undefined) {
    parts.push(`Cost: ${formatCost(metrics.cost_usd)}`);
  }

  if (metrics.llm_call_count !== undefined) {
    parts.push(`LLM calls: ${metrics.llm_call_count}`);
  }

  return parts.join(' | ');
}

/**
 * Render per-evaluator scores inline.
 */
function renderScores(scores: { name: string; score: number; type: string }[]): string {
  return scores
    .map((s) => {
      const scoreColor = s.score >= 0.9 ? c.green : s.score >= 0.5 ? c.yellow : c.red;
      return `${s.name} ${scoreColor}${formatScore(s.score)}${c.reset}`;
    })
    .join(' | ');
}

// Raw output message shape (snake_case from JSONL)
interface RawMessage {
  role?: string;
  content?: unknown;
  tool_calls?: RawToolCall[];
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  token_usage?: { input: number; output: number; cached?: number };
}

interface RawToolCall {
  tool: string;
  input?: unknown;
  output?: unknown;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
}

/**
 * Render tree view from output messages.
 * Shows a hierarchical trace: LLM calls → tool calls.
 */
function renderTree(result: RawResult): string {
  const messages = result.output as RawMessage[] | undefined;

  if (!messages || messages.length === 0) {
    // Fallback to flat summary
    if (result.metrics) {
      return renderFlatMetrics(result.metrics);
    }
    return `${c.dim}No metrics data available${c.reset}`;
  }

  const lines: string[] = [];
  const testId = result.test_id ?? result.eval_id ?? 'unknown';

  // Root node: test execution
  const totalDuration = result.metrics?.duration_ms;
  const totalTokens = result.metrics?.token_usage
    ? result.metrics.token_usage.input + result.metrics.token_usage.output
    : undefined;
  const rootParts: string[] = [testId];
  if (totalDuration !== undefined) rootParts.push(formatDuration(totalDuration));
  if (totalTokens !== undefined) rootParts.push(`${formatNumber(totalTokens)} tok`);
  if (result.metrics?.cost_usd !== undefined) rootParts.push(formatCost(result.metrics.cost_usd));
  lines.push(`${c.bold}${rootParts.join(', ')}${c.reset}`);

  // Filter to meaningful messages (assistant with tool calls, or assistant responses)
  const steps: { type: 'llm' | 'tools'; msg: RawMessage; index: number }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        steps.push({ type: 'tools', msg, index: i });
      } else {
        steps.push({ type: 'llm', msg, index: i });
      }
    }
  }

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const isLast = si === steps.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    if (step.type === 'llm') {
      // LLM response without tool calls
      const parts: string[] = [`${c.cyan}model${c.reset}`];
      if (step.msg.duration_ms !== undefined) parts.push(formatDuration(step.msg.duration_ms));
      if (step.msg.token_usage) {
        const tok = step.msg.token_usage.input + step.msg.token_usage.output;
        parts.push(`${formatNumber(tok)} tok`);
      }
      lines.push(`${connector} ${parts.join(', ')}`);
    } else {
      // Tool calls
      const toolCalls = step.msg.tool_calls ?? [];

      if (toolCalls.length === 1) {
        // Single tool call — inline
        const tc = toolCalls[0];
        const parts: string[] = [`${c.yellow}${tc.tool}${c.reset}`];
        if (tc.duration_ms !== undefined) parts.push(formatDuration(tc.duration_ms));
        lines.push(`${connector} ${parts.join(', ')}`);
      } else {
        // Multiple tool calls — expand
        const parts: string[] = [`${c.dim}tools${c.reset}`];
        if (step.msg.duration_ms !== undefined) parts.push(formatDuration(step.msg.duration_ms));
        lines.push(`${connector} ${parts.join(', ')}`);

        for (let ti = 0; ti < toolCalls.length; ti++) {
          const tc = toolCalls[ti];
          const isLastTool = ti === toolCalls.length - 1;
          const toolConnector = isLastTool ? '└─' : '├─';
          const tcParts: string[] = [`${c.yellow}${tc.tool}${c.reset}`];
          if (tc.duration_ms !== undefined) tcParts.push(formatDuration(tc.duration_ms));
          lines.push(`${childPrefix}${toolConnector} ${tcParts.join(', ')}`);
        }
      }
    }
  }

  // Scores line
  if (result.scores && result.scores.length > 0) {
    lines.push('');
    lines.push(`${c.dim}Scores:${c.reset} ${renderScores(result.scores)}`);
  }

  return lines.join('\n');
}

/**
 * Format a single result for table display.
 */
function formatResultDetail(result: RawResult, index: number, tree: boolean): string {
  const lines: string[] = [];
  const testId = result.test_id ?? result.eval_id ?? `result-${index}`;

  if (tree) {
    // Tree view
    lines.push(renderTree(result));
    return lines.join('\n');
  }

  // Standard flat view
  const scoreColor = result.score >= 0.9 ? c.green : result.score >= 0.5 ? c.yellow : c.red;
  lines.push(
    `${c.bold}${testId}${c.reset}  ${scoreColor}${formatScore(result.score)}${c.reset}${result.target ? `  ${c.dim}target: ${result.target}${c.reset}` : ''}${result.dataset ? `  ${c.dim}dataset: ${result.dataset}${c.reset}` : ''}`,
  );

  if (result.error) {
    lines.push(`  ${c.red}Error: ${result.error}${c.reset}`);
  }

  if (result.hits && result.hits.length > 0) {
    lines.push(`  ${c.green}✓ Hits:${c.reset} ${result.hits.join(', ')}`);
  }
  if (result.misses && result.misses.length > 0) {
    lines.push(`  ${c.red}✗ Misses:${c.reset} ${result.misses.join(', ')}`);
  }

  if (result.scores && result.scores.length > 0) {
    lines.push(`  ${c.dim}Scores:${c.reset} ${renderScores(result.scores)}`);
  }

  if (result.metrics) {
    lines.push(`  ${c.dim}Metrics:${c.reset} ${renderFlatMetrics(result.metrics)}`);
  }

  if (result.reasoning) {
    const maxLen = 200;
    const truncated =
      result.reasoning.length > maxLen
        ? `${result.reasoning.slice(0, maxLen)}...`
        : result.reasoning;
    lines.push(`  ${c.dim}Reasoning: ${truncated}${c.reset}`);
  }

  return lines.join('\n');
}

function formatShowTable(
  results: RawResult[],
  filePath: string,
  testIdFilter?: string,
  tree?: boolean,
): string {
  const lines: string[] = [];

  let filtered = results;
  if (testIdFilter) {
    filtered = results.filter((r) => (r.test_id ?? r.eval_id) === testIdFilter);
    if (filtered.length === 0) {
      lines.push(`${c.yellow}No results found with test ID "${testIdFilter}"${c.reset}`);
      lines.push('');
      lines.push(`${c.dim}Available test IDs:${c.reset}`);
      for (const r of results) {
        lines.push(`  ${r.test_id ?? r.eval_id ?? '(unnamed)'}`);
      }
      return lines.join('\n');
    }
  }

  lines.push('');
  lines.push(`${c.bold}Results:${c.reset} ${c.cyan}${filePath}${c.reset}`);

  const totalTests = filtered.length;
  const passCount = filtered.filter((r) => r.score >= 1.0).length;
  const failCount = totalTests - passCount;
  const avgScore = totalTests > 0 ? filtered.reduce((sum, r) => sum + r.score, 0) / totalTests : 0;

  lines.push(
    `${c.dim}${totalTests} test${totalTests !== 1 ? 's' : ''} | ${c.green}${passCount} passed${c.reset}${c.dim}${failCount > 0 ? ` | ${c.red}${failCount} failed${c.reset}${c.dim}` : ''} | avg score: ${formatScore(avgScore)}${c.reset}`,
  );
  lines.push('');

  for (let i = 0; i < filtered.length; i++) {
    lines.push(formatResultDetail(filtered[i], i, tree ?? false));
    if (i < filtered.length - 1) {
      lines.push(`${c.dim}${'─'.repeat(60)}${c.reset}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export const traceShowCommand = command({
  name: 'show',
  description: 'Show evaluation results with trace details from a result file',
  args: {
    file: positional({
      type: string,
      displayName: 'result-file',
      description: 'Path to JSONL result file',
    }),
    testId: option({
      type: optional(string),
      long: 'test-id',
      description: 'Filter to a specific test ID',
    }),
    tree: flag({
      long: 'tree',
      description: 'Show hierarchical trace tree (requires results with --trace output)',
    }),
    format: option({
      type: optional(oneOf(['table', 'json'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default) or json',
    }),
  },
  handler: async ({ file, testId, tree, format }) => {
    const outputFormat = format ?? 'table';

    try {
      const results = loadResultFile(file);

      let filtered = results;
      if (testId) {
        filtered = results.filter((r) => (r.test_id ?? r.eval_id) === testId);
      }

      if (outputFormat === 'json') {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(formatShowTable(results, file, testId, tree));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
