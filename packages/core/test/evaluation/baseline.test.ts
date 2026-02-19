import { describe, expect, it } from 'vitest';
import { trimBaselineResult } from '../../src/evaluation/baseline.js';
import type { EvaluationResult, EvaluatorResult } from '../../src/evaluation/types.js';

function makeFullResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    evalId: 'test-case',
    dataset: 'test-dataset',
    conversationId: 'conv-1',
    score: 0.85,
    hits: ['hit-1'],
    misses: ['miss-1'],
    candidateAnswer: 'A very long candidate answer that bloats the file...',
    target: 'test-target',
    reasoning: 'Good answer',
    lmProviderRequest: { chat_prompt: [{ role: 'user', content: 'hello' }] },
    agentProviderRequest: { model: 'gpt-4' },
    evaluatorProviderRequest: { user_prompt: 'evaluate this', system_prompt: 'you are a judge' },
    traceSummary: {
      event_count: 5,
      tool_names: ['Read'],
      tool_calls_by_name: { Read: 5 },
      error_count: 0,
    },
    workspacePath: '/tmp/workspace-123',
    outputMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }],
    setupOutput: 'setup done',
    teardownOutput: 'teardown done',
    fileChanges: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new',
    ...overrides,
  };
}

function makeEvaluatorResult(overrides: Partial<EvaluatorResult> = {}): EvaluatorResult {
  return {
    name: 'test-evaluator',
    type: 'llm_judge',
    score: 0.9,
    weight: 1,
    verdict: 'pass',
    hits: ['good'],
    misses: [],
    reasoning: 'Well done',
    rawRequest: { prompt: 'evaluate' },
    evaluatorProviderRequest: { user_prompt: 'long prompt', system_prompt: 'system' },
    details: { tp: 5, fp: 0 },
    ...overrides,
  };
}

describe('trimBaselineResult', () => {
  it('strips top-level debug fields', () => {
    const full = makeFullResult();
    const trimmed = trimBaselineResult(full);

    expect(trimmed.timestamp).toBe(full.timestamp);
    expect(trimmed.evalId).toBe(full.evalId);
    expect(trimmed.dataset).toBe(full.dataset);
    expect(trimmed.conversationId).toBe(full.conversationId);
    expect(trimmed.score).toBe(full.score);
    expect(trimmed.hits).toEqual(full.hits);
    expect(trimmed.misses).toEqual(full.misses);
    expect(trimmed.target).toBe(full.target);
    expect(trimmed.reasoning).toBe(full.reasoning);

    expect(trimmed.candidateAnswer).toBeUndefined();
    expect(trimmed.lmProviderRequest).toBeUndefined();
    expect(trimmed.agentProviderRequest).toBeUndefined();
    expect(trimmed.evaluatorProviderRequest).toBeUndefined();
    expect(trimmed.traceSummary).toBeUndefined();
    expect(trimmed.workspacePath).toBeUndefined();
    expect(trimmed.outputMessages).toBeUndefined();
    expect(trimmed.setupOutput).toBeUndefined();
    expect(trimmed.teardownOutput).toBeUndefined();
    expect(trimmed.fileChanges).toBeUndefined();
  });

  it('preserves error field when present', () => {
    const full = makeFullResult({ error: 'something went wrong' });
    const trimmed = trimBaselineResult(full);
    expect(trimmed.error).toBe('something went wrong');
  });

  it('trims evaluator results', () => {
    const evaluatorResult = makeEvaluatorResult();
    const full = makeFullResult({ evaluatorResults: [evaluatorResult] });
    const trimmed = trimBaselineResult(full);

    expect(trimmed.evaluatorResults).toHaveLength(1);
    const er = trimmed.evaluatorResults?.[0];
    expect(er.name).toBe('test-evaluator');
    expect(er.type).toBe('llm_judge');
    expect(er.score).toBe(0.9);
    expect(er.weight).toBe(1);
    expect(er.verdict).toBe('pass');
    expect(er.hits).toEqual(['good']);
    expect(er.misses).toEqual([]);
    expect(er.reasoning).toBe('Well done');
    expect(er.details).toEqual({ tp: 5, fp: 0 });

    expect(er.rawRequest).toBeUndefined();
    expect(er.evaluatorProviderRequest).toBeUndefined();
  });

  it('recursively trims composite evaluator results', () => {
    const inner = makeEvaluatorResult({ name: 'inner' });
    const composite = makeEvaluatorResult({
      name: 'composite',
      type: 'composite',
      evaluatorResults: [inner],
    });
    const full = makeFullResult({ evaluatorResults: [composite] });
    const trimmed = trimBaselineResult(full);

    const outerEr = trimmed.evaluatorResults?.[0];
    expect(outerEr.rawRequest).toBeUndefined();
    expect(outerEr.evaluatorProviderRequest).toBeUndefined();
    expect(outerEr.evaluatorResults).toHaveLength(1);

    const innerEr = outerEr.evaluatorResults?.[0];
    expect(innerEr.name).toBe('inner');
    expect(innerEr.rawRequest).toBeUndefined();
    expect(innerEr.evaluatorProviderRequest).toBeUndefined();
    expect(innerEr.score).toBe(0.9);
  });

  it('does not mutate the original result', () => {
    const evaluatorResult = makeEvaluatorResult();
    const full = makeFullResult({ evaluatorResults: [evaluatorResult] });
    const originalJson = JSON.stringify(full);

    trimBaselineResult(full);

    expect(JSON.stringify(full)).toBe(originalJson);
  });

  it('handles result with no evaluator results', () => {
    const full = makeFullResult();
    const trimmed = trimBaselineResult(full);
    expect(trimmed.evaluatorResults).toBeUndefined();
  });

  it('preserves unknown future fields (denylist approach)', () => {
    const full = makeFullResult() as EvaluationResult & { futureField: string };
    (full as Record<string, unknown>).futureField = 'should be kept';
    const trimmed = trimBaselineResult(full) as EvaluationResult & { futureField: string };
    expect(trimmed.futureField).toBe('should be kept');
  });
});
