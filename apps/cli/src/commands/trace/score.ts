import {
  type EvalTest,
  type EvaluationContext,
  type EvaluationScore,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorDispatchContext,
  type Message,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
  type TraceSummary,
  createBuiltinRegistry,
  toCamelCaseDeep,
} from '@agentv/core';
import { command, oneOf, option, optional, positional, string } from 'cmd-ts';
import { type RawResult, c, formatScore, loadResultFile, padLeft, padRight } from './utils.js';

/**
 * Evaluator types that work without an LLM provider.
 */
const SUPPORTED_TYPES = [
  'contains',
  'regex',
  'is-json',
  'equals',
  'latency',
  'cost',
  'token-usage',
  'execution-metrics',
] as const;

/**
 * Parse key=value pairs from a string like "max_tool_calls=10,max_tokens=2000"
 */
function parseKeyValues(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!s) return result;
  for (const pair of s.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    result[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
  }
  return result;
}

/**
 * Parse an inline evaluator spec string into an EvaluatorConfig.
 *
 * Supported formats:
 *   contains:value
 *   regex:pattern
 *   is-json
 *   equals:value
 *   latency:<threshold_ms>
 *   cost:<budget_usd>
 *   token-usage:max_total=N,max_input=N,max_output=N
 *   execution-metrics:max_tool_calls=N,max_tokens=N,max_llm_calls=N,...
 */
export function parseAssertSpec(spec: string): EvaluatorConfig {
  const colonIdx = spec.indexOf(':');
  // Normalize snake_case to kebab-case for backward compat
  const type = (colonIdx === -1 ? spec : spec.slice(0, colonIdx)).replace(/_/g, '-');
  const params = colonIdx === -1 ? '' : spec.slice(colonIdx + 1);

  switch (type) {
    case 'contains':
      if (!params) throw new Error('contains requires a value: contains:<value>');
      return { name: 'contains', type: 'contains', value: params } as EvaluatorConfig;

    case 'regex':
      if (!params) throw new Error('regex requires a pattern: regex:<pattern>');
      return { name: 'regex', type: 'regex', value: params } as EvaluatorConfig;

    case 'is-json':
      return { name: 'is-json', type: 'is-json' } as EvaluatorConfig;

    case 'equals':
      if (!params) throw new Error('equals requires a value: equals:<value>');
      return { name: 'equals', type: 'equals', value: params } as EvaluatorConfig;

    case 'latency': {
      const threshold = Number(params);
      if (!params || Number.isNaN(threshold))
        throw new Error('latency requires a threshold in ms: latency:<ms>');
      return { name: 'latency', type: 'latency', threshold } as EvaluatorConfig;
    }

    case 'cost': {
      const budget = Number(params);
      if (!params || Number.isNaN(budget))
        throw new Error('cost requires a budget in USD: cost:<usd>');
      return { name: 'cost', type: 'cost', budget } as EvaluatorConfig;
    }

    case 'token-usage': {
      const kv = parseKeyValues(params);
      const config: Record<string, unknown> = { name: 'token-usage', type: 'token-usage' };
      if (kv.max_total) config.max_total = Number(kv.max_total);
      if (kv.max_input) config.max_input = Number(kv.max_input);
      if (kv.max_output) config.max_output = Number(kv.max_output);
      return config as EvaluatorConfig;
    }

    case 'execution-metrics': {
      const kv = parseKeyValues(params);
      const config: Record<string, unknown> = {
        name: 'execution-metrics',
        type: 'execution-metrics',
      };
      if (kv.max_tool_calls) config.max_tool_calls = Number(kv.max_tool_calls);
      if (kv.max_llm_calls) config.max_llm_calls = Number(kv.max_llm_calls);
      if (kv.max_tokens) config.max_tokens = Number(kv.max_tokens);
      if (kv.max_cost_usd) config.max_cost_usd = Number(kv.max_cost_usd);
      if (kv.max_duration_ms) config.max_duration_ms = Number(kv.max_duration_ms);
      return config as EvaluatorConfig;
    }

    default:
      throw new Error(
        `Unsupported evaluator type: "${type}". Supported: ${SUPPORTED_TYPES.join(', ')}`,
      );
  }
}

/**
 * Convert a snake_case RawResult trace to camelCase TraceSummary.
 */
function toTraceSummary(raw: RawResult): TraceSummary | undefined {
  if (!raw.trace) return undefined;
  return toCamelCaseDeep(raw.trace) as TraceSummary;
}

/**
 * Extract candidate answer from a result record.
 * Checks `output_text` for backward compat with older JSONL, then `output`.
 */
function extractCandidate(raw: RawResult): string {
  if (raw.output_text !== undefined) return raw.output_text;
  if (raw.output !== undefined)
    return typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output);
  return '';
}

/**
 * Build a minimal EvalTest stub from a result record.
 * Only used to satisfy the EvaluationContext interface — deterministic and
 * trace-based evaluators don't access these fields.
 */
function buildEvalTest(raw: RawResult): EvalTest {
  return {
    id: raw.test_id ?? 'unknown',
    question: '',
    input: [],
    input_segments: [],
    expected_output: [],
    guideline_paths: [],
    file_paths: [],
    criteria: '',
  };
}

/**
 * A no-op provider stub for evaluators that don't call LLM providers.
 */
const stubProvider: Provider = {
  id: 'trace-score-stub',
  kind: 'mock',
  targetName: 'trace-score-stub',
  invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    throw new Error('trace score does not support LLM-based evaluators');
  },
};

/**
 * A no-op evaluator stub used as the required llmGrader in the dispatch context.
 */
const stubLlmGrader: Evaluator = {
  kind: 'llm-grader',
  evaluate(): EvaluationScore {
    throw new Error('trace score does not support LLM-based evaluators');
  },
};

interface ScoreResult {
  testId: string;
  candidate: string;
  originalScore: number;
  newScore: number;
  verdict: string;
  assertions: readonly { text: string; passed: boolean; evidence?: string }[];
}

async function runScore(
  results: RawResult[],
  evaluatorConfig: EvaluatorConfig,
  testIdFilter?: string,
): Promise<ScoreResult[]> {
  const registry = createBuiltinRegistry();

  const dispatchContext: EvaluatorDispatchContext = {
    llmGrader: stubLlmGrader,
    registry,
  };

  const evaluator = await registry.create(evaluatorConfig, dispatchContext);
  const scored: ScoreResult[] = [];

  for (const raw of results) {
    if (testIdFilter && raw.test_id !== testIdFilter) continue;

    const trace = toTraceSummary(raw);
    const candidate = extractCandidate(raw);
    const output = raw.output as readonly Message[] | undefined;

    const evalContext: EvaluationContext = {
      evalCase: buildEvalTest(raw),
      candidate,
      target: { kind: 'custom' as const, name: raw.target ?? 'unknown', config: {} } as never,
      provider: stubProvider,
      attempt: 1,
      promptInputs: { question: '', guidelines: '' },
      now: new Date(),
      output: Array.isArray(output) ? output : undefined,
      trace,
      tokenUsage: raw.token_usage
        ? (toCamelCaseDeep(raw.token_usage) as EvaluationContext['tokenUsage'])
        : undefined,
      costUsd: raw.cost_usd,
      durationMs: raw.duration_ms,
      startTime: raw.start_time,
      endTime: raw.end_time,
    };

    const score = await evaluator.evaluate(evalContext);
    scored.push({
      testId: raw.test_id ?? 'unknown',
      candidate: candidate.slice(0, 80),
      originalScore: raw.score,
      newScore: score.score,
      verdict: score.verdict,
      assertions: score.assertions,
    });
  }

  return scored;
}

function renderTable(scored: ScoreResult[], assertSpec: string): string {
  const lines: string[] = [];

  // Header
  const cols = [
    { header: 'Test ID', width: 24 },
    { header: 'Orig', width: 6 },
    { header: 'New', width: 6 },
    { header: 'Verdict', width: 8 },
    { header: 'Detail', width: 50 },
  ];

  const headerLine = cols
    .map((col) => padRight(`${c.bold}${col.header}${c.reset}`, col.width))
    .join('  ');
  lines.push(headerLine);
  lines.push(cols.map((col) => '─'.repeat(col.width)).join('──'));

  for (const r of scored) {
    const verdictColor = r.verdict === 'pass' ? c.green : c.red;
    const failed = r.assertions.filter((a) => !a.passed);
    const passed = r.assertions.filter((a) => a.passed);
    const detail =
      failed.length > 0
        ? failed[0].text.slice(0, 48)
        : passed.length > 0
          ? passed[0].text.slice(0, 48)
          : '';

    const row = [
      padRight(r.testId.slice(0, 24), cols[0].width),
      padLeft(formatScore(r.originalScore), cols[1].width),
      padLeft(`${verdictColor}${formatScore(r.newScore)}${c.reset}`, cols[2].width),
      padRight(`${verdictColor}${r.verdict.toUpperCase()}${c.reset}`, cols[3].width),
      detail.slice(0, cols[4].width),
    ].join('  ');
    lines.push(row);
  }

  // Summary
  const passCount = scored.filter((r) => r.verdict === 'pass').length;
  const total = scored.length;
  const meanScore = total > 0 ? scored.reduce((sum, r) => sum + r.newScore, 0) / total : 0;
  lines.push('');
  lines.push(
    `${c.bold}Assert:${c.reset} ${assertSpec}  ${c.bold}Results:${c.reset} ${passCount}/${total} passed (${formatScore(passCount / (total || 1))})  ${c.bold}Mean:${c.reset} ${formatScore(meanScore)}`,
  );

  return lines.join('\n');
}

export const traceScoreCommand = command({
  name: 'score',
  description: 'Run evaluators against existing result files post-hoc',
  args: {
    file: positional({
      type: string,
      displayName: 'result-file',
      description: 'Path to JSONL result file',
    }),
    assert: option({
      type: string,
      long: 'assert',
      short: 'a',
      description:
        'Evaluator spec: contains:<val>, regex:<pat>, is-json, equals:<val>, latency:<ms>, cost:<usd>, token-usage:<params>, execution-metrics:<params>',
    }),
    testId: option({
      type: optional(string),
      long: 'test-id',
      description: 'Filter to a specific test ID',
    }),
    format: option({
      type: optional(oneOf(['json', 'table'])),
      long: 'format',
      short: 'f',
      description: 'Output format (default: table)',
    }),
  },
  handler: async ({ file, assert: assertSpec, testId, format }) => {
    // Parse the evaluator spec
    let evaluatorConfig: EvaluatorConfig;
    try {
      evaluatorConfig = parseAssertSpec(assertSpec);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${c.red}Error:${c.reset} ${msg}`);
      process.exit(1);
    }

    // Load results
    let results: RawResult[];
    try {
      results = loadResultFile(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${c.red}Error:${c.reset} Could not load result file: ${msg}`);
      process.exit(1);
    }

    if (results.length === 0) {
      console.error(`${c.yellow}Warning:${c.reset} No results found in ${file}`);
      process.exit(0);
    }

    // Check for trace data if evaluator needs it
    const traceRequired = ['latency', 'cost', 'token-usage', 'execution-metrics'].includes(
      evaluatorConfig.type,
    );
    if (traceRequired) {
      const hasTrace = results.some(
        (r) =>
          r.trace ||
          r.cost_usd !== undefined ||
          r.duration_ms !== undefined ||
          r.token_usage !== undefined,
      );
      if (!hasTrace) {
        console.error(
          `${c.red}Error:${c.reset} Result file lacks trace data. Re-run eval with ${c.bold}--trace${c.reset} to capture trace summaries.`,
        );
        process.exit(1);
      }
    }

    // Run scoring
    let scored: ScoreResult[];
    try {
      scored = await runScore(results, evaluatorConfig, testId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${c.red}Error:${c.reset} Scoring failed: ${msg}`);
      process.exit(1);
    }

    if (scored.length === 0) {
      console.error(
        `${c.yellow}Warning:${c.reset} No results matched${testId ? ` test ID "${testId}"` : ''}`,
      );
      process.exit(0);
    }

    // Output
    if (format === 'json') {
      console.log(JSON.stringify(scored, null, 2));
    } else {
      console.log(renderTable(scored, assertSpec));
    }

    // Exit with non-zero if any failed
    const hasFailures = scored.some((r) => r.verdict !== 'pass');
    if (hasFailures) {
      process.exit(1);
    }
  },
});
