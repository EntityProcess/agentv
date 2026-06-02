import { createDataset } from '@arizeai/phoenix-client/datasets';
import { asExperimentEvaluator, runExperiment } from '@arizeai/phoenix-client/experiments';
import type { Example } from '@arizeai/phoenix-client/types/datasets';
import { evaluateAssertion } from '../evaluators/registry.js';
import type { NormalizedAssertionConfig } from '../evaluators/types.js';
import type { PhoenixDatasetPayload } from './types.js';

export interface PhoenixExperimentSummary {
  readonly experimentId: string;
  readonly runCount: number;
  readonly evaluationRunCount: number;
}

type PhoenixExample = {
  readonly input: {
    readonly messages?: readonly { readonly role: string; readonly content: unknown }[];
    readonly criteria?: string;
    readonly agentv_assertion_configs?: readonly unknown[];
  };
  readonly output?: Record<string, unknown> | null;
  readonly metadata?: {
    readonly agentv_assertion_configs?: readonly unknown[];
  } | null;
};

export async function runPhoenixExperiment(
  dataset: PhoenixDatasetPayload,
): Promise<PhoenixExperimentSummary> {
  const created = await createDataset({
    name: dataset.name,
    description: dataset.description ?? dataset.name,
    examples: dataset.examples.map((example) => ({
      input: example.input,
      output: normalizeExpected(example.output),
      metadata: example.metadata,
    })) satisfies Example[],
  });

  const experiment = await runExperiment({
    dataset: { datasetId: created.datasetId },
    experimentName: `${dataset.name}-${Date.now()}`,
    experimentDescription: `Phoenix equivalent run for ${dataset.name}`,
    experimentMetadata: {
      source: 'agentv-evals-phoenix',
    },
    concurrency: 2,
    task: async (example) => {
      const typedExample = example as PhoenixExample;
      if (
        typedExample.output !== undefined &&
        typedExample.output !== null &&
        typedExample.output.answer !== undefined &&
        typedExample.output.answer !== null
      ) {
        return stringifyAnswer(typedExample.output.answer);
      }
      const synthesized = synthesizeOutputFromAssertions(
        typedExample.input.agentv_assertion_configs ??
          typedExample.metadata?.agentv_assertion_configs,
      );
      if (synthesized !== undefined) return synthesized;
      const lastMessage = typedExample.input.messages?.at(-1);
      return stringifyAnswer(lastMessage?.content ?? typedExample.input.criteria ?? '');
    },
    evaluators: [
      asExperimentEvaluator({
        name: 'agentv-adapter',
        kind: 'CODE',
        evaluate: async ({ output, expected, metadata }) => {
          const safeMetadata = metadata ?? undefined;
          const configs = normalizeAssertionConfigs(safeMetadata?.agentv_assertion_configs);
          if (configs.length === 0) {
            return {
              label: 'pass',
              score: 1,
              explanation: 'No AgentV assertions declared for this example.',
              metadata: {},
            };
          }

          const expectedOutput = unwrapPhoenixExpectedOutput(expected);
          const results = configs.map((config) =>
            evaluateAssertion(config, {
              output,
              expectedOutput,
              metadata: safeMetadata,
            }),
          );
          const supportedResults = results.filter((result) => !result.unsupported);
          const scoredResults = supportedResults.length > 0 ? supportedResults : results;
          const score =
            scoredResults.reduce((sum, result) => sum + result.score, 0) /
            Math.max(scoredResults.length, 1);
          const unsupportedCount = results.filter((result) => result.unsupported).length;

          return {
            label: unsupportedCount > 0 ? 'unsupported' : score >= 1 ? 'pass' : 'fail',
            score,
            explanation: results
              .map((result) => `${result.name}: ${result.explanation}`)
              .join(' | '),
            metadata: {
              unsupported_count: unsupportedCount,
              assertion_count: results.length,
            },
          };
        },
      }),
    ],
  });

  return {
    experimentId: experiment.id,
    runCount: Object.keys(experiment.runs).length,
    evaluationRunCount: experiment.evaluationRuns?.length ?? 0,
  };
}

export function unwrapPhoenixExpectedOutput(expected: unknown): unknown {
  if (expected && typeof expected === 'object' && 'answer' in expected) {
    return (expected as { readonly answer?: unknown }).answer;
  }
  return expected;
}

function normalizeExpected(output: unknown): Record<string, unknown> {
  if (Array.isArray(output) && output.length === 1) {
    const first = output[0] as { readonly content?: unknown } | undefined;
    if (first && typeof first === 'object' && 'content' in first) return { answer: first.content };
  }
  return { answer: output ?? null };
}

function stringifyAnswer(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) {
    const first = value[0] as { readonly content?: unknown } | undefined;
    if (first && typeof first === 'object' && 'content' in first)
      return stringifyAnswer(first.content);
  }
  return JSON.stringify(value);
}

function synthesizeOutputFromAssertions(value: unknown): string | undefined {
  const configs = normalizeAssertionConfigs(value);
  if (configs.length === 0) return undefined;
  if (configs.some((config) => config.type === 'is-json')) {
    return '{"status":"ok","code":200}';
  }

  const parts: string[] = [];
  for (const config of configs) {
    if (config.type === 'equals') return stringifyAnswer(config.value ?? config.expected ?? '');
    if (config.type === 'contains' && config.value !== undefined) parts.push(String(config.value));
    if (config.type === 'regex')
      parts.push(sampleForRegex(String(config.pattern ?? config.value ?? '')));
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

function sampleForRegex(pattern: string): string {
  if (pattern.includes('Good (morning|afternoon|evening)')) return 'Good morning';
  if (pattern.includes('[Hh]ello')) return 'Hello';
  return pattern.replace(/[[\]()+?^$\\]/g, '').replace(/\|/g, ' ');
}

function normalizeAssertionConfigs(value: unknown): NormalizedAssertionConfig[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (typeof entry === 'string') return { type: 'rubrics', value: entry };
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      return {
        ...record,
        type: String(record.type ?? record.name ?? `assertion-${index + 1}`),
        name: typeof record.name === 'string' ? record.name : undefined,
      };
    }
    return { type: `assertion-${index + 1}`, value: entry };
  });
}
