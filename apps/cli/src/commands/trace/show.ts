import { command, oneOf, option, optional, positional, string } from 'cmd-ts';
import {
  type RawResult,
  type RawTraceSummary,
  c,
  formatCost,
  formatDuration,
  formatNumber,
  formatScore,
  loadResultFile,
} from './utils.js';

/**
 * Render flat trace summary line (fallback when full output messages not available).
 */
function renderFlatTrace(trace: RawTraceSummary): string {
  const parts: string[] = [];

  if (trace.tool_names && trace.tool_names.length > 0) {
    const toolParts = trace.tool_names.map((name) => {
      const count = trace.tool_calls_by_name?.[name] ?? 0;
      return count > 1 ? `${name} ×${count}` : name;
    });
    parts.push(`Tools: ${toolParts.join(', ')}`);
  }

  if (trace.duration_ms !== undefined) {
    parts.push(`Duration: ${formatDuration(trace.duration_ms)}`);
  }

  if (trace.token_usage) {
    const total = trace.token_usage.input + trace.token_usage.output;
    parts.push(`Tokens: ${formatNumber(total)}`);
  }

  if (trace.cost_usd !== undefined) {
    parts.push(`Cost: ${formatCost(trace.cost_usd)}`);
  }

  if (trace.llm_call_count !== undefined) {
    parts.push(`LLM calls: ${trace.llm_call_count}`);
  }

  return parts.join(' | ');
}

/**
 * Render per-evaluator scores.
 */
function renderScores(scores: { name: string; score: number; type: string }[]): string {
  return scores
    .map((s) => {
      const scoreColor = s.score >= 0.9 ? c.green : s.score >= 0.5 ? c.yellow : c.red;
      return `${s.name} ${scoreColor}${formatScore(s.score)}${c.reset}`;
    })
    .join(' | ');
}

/**
 * Format a single result for table display.
 */
function formatResultDetail(result: RawResult, index: number): string {
  const lines: string[] = [];
  const testId = result.test_id ?? result.eval_id ?? `result-${index}`;

  // Header
  const scoreColor = result.score >= 0.9 ? c.green : result.score >= 0.5 ? c.yellow : c.red;
  lines.push(
    `${c.bold}${testId}${c.reset}  ${scoreColor}${formatScore(result.score)}${c.reset}${result.target ? `  ${c.dim}target: ${result.target}${c.reset}` : ''}${result.dataset ? `  ${c.dim}dataset: ${result.dataset}${c.reset}` : ''}`,
  );

  // Error
  if (result.error) {
    lines.push(`  ${c.red}Error: ${result.error}${c.reset}`);
  }

  // Hits and misses
  if (result.hits && result.hits.length > 0) {
    lines.push(`  ${c.green}✓ Hits:${c.reset} ${result.hits.join(', ')}`);
  }
  if (result.misses && result.misses.length > 0) {
    lines.push(`  ${c.red}✗ Misses:${c.reset} ${result.misses.join(', ')}`);
  }

  // Per-evaluator scores
  if (result.scores && result.scores.length > 0) {
    lines.push(`  ${c.dim}Scores:${c.reset} ${renderScores(result.scores)}`);
  }

  // Trace summary
  if (result.trace) {
    lines.push(`  ${c.dim}Trace:${c.reset} ${renderFlatTrace(result.trace)}`);
  }

  // Reasoning (truncated)
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

function formatShowTable(results: RawResult[], filePath: string, testIdFilter?: string): string {
  const lines: string[] = [];

  // Filter by test ID if specified
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

  // Summary line
  const totalTests = filtered.length;
  const passCount = filtered.filter((r) => r.score >= 1.0).length;
  const failCount = totalTests - passCount;
  const avgScore = totalTests > 0 ? filtered.reduce((sum, r) => sum + r.score, 0) / totalTests : 0;

  lines.push(
    `${c.dim}${totalTests} test${totalTests !== 1 ? 's' : ''} | ${c.green}${passCount} passed${c.reset}${c.dim}${failCount > 0 ? ` | ${c.red}${failCount} failed${c.reset}${c.dim}` : ''} | avg score: ${formatScore(avgScore)}${c.reset}`,
  );
  lines.push('');

  // Individual results
  for (let i = 0; i < filtered.length; i++) {
    lines.push(formatResultDetail(filtered[i], i));
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
    format: option({
      type: optional(oneOf(['table', 'json', 'yaml'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default), json, or yaml',
    }),
  },
  handler: async ({ file, testId, format }) => {
    const outputFormat = format ?? 'table';

    try {
      const results = loadResultFile(file);

      // Filter by test ID if specified
      let filtered = results;
      if (testId) {
        filtered = results.filter((r) => (r.test_id ?? r.eval_id) === testId);
      }

      if (outputFormat === 'json') {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(formatShowTable(results, file, testId));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
