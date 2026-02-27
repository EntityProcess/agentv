import { command, oneOf, option, optional, positional, string } from 'cmd-ts';
import { toSnakeCaseDeep } from '../../utils/case-conversion.js';
import {
  type RawResult,
  c,
  formatCost,
  formatNumber,
  loadResultFile,
  padLeft,
  padRight,
} from './utils.js';

/**
 * Compute percentiles from a sorted array of numbers.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface MetricRow {
  name: string;
  values: number[];
  formatter: (n: number) => string;
}

function collectMetrics(results: RawResult[]): MetricRow[] {
  const rows: MetricRow[] = [];

  // Score
  const scores = results.map((r) => r.score);
  if (scores.length > 0) {
    rows.push({ name: 'score', values: scores, formatter: (n) => n.toFixed(2) });
  }

  // Latency
  const latencies = results
    .map((r) => r.duration_ms)
    .filter((v): v is number => v !== undefined);
  if (latencies.length > 0) {
    rows.push({
      name: 'latency_s',
      values: latencies.map((ms) => ms / 1000),
      formatter: (n) => n.toFixed(1),
    });
  }

  // Cost
  const costs = results.map((r) => r.cost_usd).filter((v): v is number => v !== undefined);
  if (costs.length > 0) {
    rows.push({ name: 'cost_usd', values: costs, formatter: (n) => formatCost(n) });
  }

  // Total tokens
  const tokens = results
    .map((r) => {
      if (!r.token_usage) return undefined;
      return r.token_usage.input + r.token_usage.output;
    })
    .filter((v): v is number => v !== undefined);
  if (tokens.length > 0) {
    rows.push({
      name: 'tokens_total',
      values: tokens,
      formatter: (n) => formatNumber(Math.round(n)),
    });
  }

  // Tool calls
  const toolCalls = results
    .map((r) => r.trace?.event_count)
    .filter((v): v is number => v !== undefined);
  if (toolCalls.length > 0) {
    rows.push({ name: 'tool_calls', values: toolCalls, formatter: (n) => String(Math.round(n)) });
  }

  // LLM calls
  const llmCalls = results
    .map((r) => r.trace?.llm_call_count)
    .filter((v): v is number => v !== undefined);
  if (llmCalls.length > 0) {
    rows.push({ name: 'llm_calls', values: llmCalls, formatter: (n) => String(Math.round(n)) });
  }

  return rows;
}

interface GroupedResults {
  label: string;
  results: RawResult[];
}

function groupResults(results: RawResult[], groupBy?: string): GroupedResults[] {
  if (!groupBy) return [{ label: 'all', results }];

  const groups = new Map<string, RawResult[]>();

  for (const result of results) {
    let key: string;
    switch (groupBy) {
      case 'target':
        key = result.target ?? 'unknown';
        break;
      case 'dataset':
        key = result.dataset ?? 'unknown';
        break;
      case 'test-id':
        key = result.test_id ?? result.eval_id ?? 'unknown';
        break;
      default:
        key = 'all';
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(result);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, results]) => ({ label, results }));
}

function formatStatsTable(groups: GroupedResults[], filePath: string): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${c.bold}Statistics:${c.reset} ${c.cyan}${filePath}${c.reset}`);

  for (const group of groups) {
    if (groups.length > 1 || group.label !== 'all') {
      lines.push('');
      lines.push(
        `${c.bold}Group: ${group.label}${c.reset} ${c.dim}(${group.results.length} tests)${c.reset}`,
      );
    } else {
      lines.push(`${c.dim}${group.results.length} tests${c.reset}`);
    }
    lines.push('');

    const metrics = collectMetrics(group.results);

    if (metrics.length === 0) {
      lines.push(`${c.yellow}No trace metrics available${c.reset}`);
      continue;
    }

    // Column headers
    const nameWidth = Math.max(12, ...metrics.map((m) => m.name.length));
    const colWidth = 10;

    const header = `  ${padRight('Metric', nameWidth)}  ${padLeft('Mean', colWidth)}  ${padLeft('P50', colWidth)}  ${padLeft('P90', colWidth)}  ${padLeft('P95', colWidth)}  ${padLeft('P99', colWidth)}`;
    lines.push(`${c.dim}${header}${c.reset}`);
    lines.push(
      `${c.dim}  ${'─'.repeat(nameWidth)}  ${'─'.repeat(colWidth)}  ${'─'.repeat(colWidth)}  ${'─'.repeat(colWidth)}  ${'─'.repeat(colWidth)}  ${'─'.repeat(colWidth)}${c.reset}`,
    );

    for (const metric of metrics) {
      const sorted = [...metric.values].sort((a, b) => a - b);
      const row = `  ${padRight(metric.name, nameWidth)}  ${padLeft(metric.formatter(mean(sorted)), colWidth)}  ${padLeft(metric.formatter(percentile(sorted, 50)), colWidth)}  ${padLeft(metric.formatter(percentile(sorted, 90)), colWidth)}  ${padLeft(metric.formatter(percentile(sorted, 95)), colWidth)}  ${padLeft(metric.formatter(percentile(sorted, 99)), colWidth)}`;
      lines.push(row);
    }
  }

  lines.push('');
  return lines.join('\n');
}

interface StatsJson {
  file: string;
  groups: {
    label: string;
    count: number;
    metrics: Record<string, { mean: number; p50: number; p90: number; p95: number; p99: number }>;
  }[];
}

function computeStatsJson(groups: GroupedResults[], filePath: string): StatsJson {
  return {
    file: filePath,
    groups: groups.map((group) => {
      const metrics = collectMetrics(group.results);
      const metricsObj: Record<
        string,
        { mean: number; p50: number; p90: number; p95: number; p99: number }
      > = {};

      for (const metric of metrics) {
        const sorted = [...metric.values].sort((a, b) => a - b);
        metricsObj[metric.name] = {
          mean: Number(mean(sorted).toFixed(4)),
          p50: Number(percentile(sorted, 50).toFixed(4)),
          p90: Number(percentile(sorted, 90).toFixed(4)),
          p95: Number(percentile(sorted, 95).toFixed(4)),
          p99: Number(percentile(sorted, 99).toFixed(4)),
        };
      }

      return {
        label: group.label,
        count: group.results.length,
        metrics: metricsObj,
      };
    }),
  };
}

export const traceStatsCommand = command({
  name: 'stats',
  description: 'Compute summary statistics (percentiles) across evaluation results',
  args: {
    file: positional({
      type: string,
      displayName: 'result-file',
      description: 'Path to JSONL result file',
    }),
    groupBy: option({
      type: optional(oneOf(['target', 'dataset', 'test-id'])),
      long: 'group-by',
      short: 'g',
      description: 'Group statistics by: target, dataset, or test-id',
    }),
    format: option({
      type: optional(oneOf(['table', 'json'])),
      long: 'format',
      short: 'f',
      description: 'Output format: table (default) or json',
    }),
  },
  handler: async ({ file, groupBy, format }) => {
    const outputFormat = format ?? 'table';

    try {
      const results = loadResultFile(file);

      if (results.length === 0) {
        console.error('Error: Result file is empty');
        process.exit(1);
      }

      const groups = groupResults(results, groupBy);

      if (outputFormat === 'json') {
        const statsJson = computeStatsJson(groups, file);
        console.log(JSON.stringify(toSnakeCaseDeep(statsJson), null, 2));
      } else {
        console.log(formatStatsTable(groups, file));
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
