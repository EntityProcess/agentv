/**
 * Unit tests for the multi-turn conversation mode feature.
 *
 * Covers:
 * - Orchestrator: runEvalCase with mode: conversation
 * - Validation: validateEvalFile with conversation mode fields
 * - Score aggregation strategies (mean, min, max)
 * - Turn failure policies (continue, stop)
 * - Window size behaviour
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runEvalCase } from '../../src/evaluation/orchestrator.js';
import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';
import { validateEvalFile } from '../../src/evaluation/validation/eval-validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class SequenceProvider implements Provider {
  readonly id: string;
  readonly kind = 'mock' as const;
  readonly targetName: string;
  readonly requests: ProviderRequest[] = [];
  private readonly responses: ProviderResponse[];
  private index = 0;

  constructor(targetName: string, responses: ProviderResponse[]) {
    this.id = `mock:${targetName}`;
    this.targetName = targetName;
    this.responses = responses;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    if (this.index >= this.responses.length) {
      throw new Error(`SequenceProvider: no more responses (called ${this.index + 1} times)`);
    }
    return this.responses[this.index++];
  }
}

class ErrorOnFirstProvider implements Provider {
  readonly id = 'error-first';
  readonly kind = 'mock' as const;
  readonly targetName = 'error-first';
  private called = false;
  private readonly fallbackResponse: ProviderResponse;

  constructor(fallback: ProviderResponse) {
    this.fallbackResponse = fallback;
  }

  async invoke(): Promise<ProviderResponse> {
    if (!this.called) {
      this.called = true;
      throw new Error('Simulated provider error');
    }
    return this.fallbackResponse;
  }
}

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

function makeEvaluatorRegistry(score = 1.0) {
  return {
    'llm-grader': {
      kind: 'llm-grader' as const,
      async evaluate() {
        return {
          score,
          verdict: score >= 0.5 ? ('pass' as const) : ('fail' as const),
          assertions: [{ text: 'graded', passed: score >= 0.5 }],
          expectedAspectCount: 1,
        };
      },
    },
  };
}

function assistantResponse(content: string): ProviderResponse {
  return { output: [{ role: 'assistant', content }] };
}

const nowFn = () => new Date('2024-01-01T00:00:00Z');

// ---------------------------------------------------------------------------
// Orchestrator — conversation mode
// ---------------------------------------------------------------------------

describe('runEvalCase — conversation mode', () => {
  it('basic 2-turn conversation with no assertions scores 1.0 and calls provider twice', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('Hello!'),
      assistantResponse('Goodbye!'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-basic',
      question: 'Chat test',
      input: [{ role: 'user', content: 'Hi' }],
      expected_output: [],
      file_paths: [],
      criteria: 'Be helpful',
      mode: 'conversation',
      turns: [
        { input: 'Turn 1 message' },
        { input: 'Turn 2 message' },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(),
      now: nowFn,
    });

    expect(result.score).toBe(1.0);
    expect(provider.requests).toHaveLength(2);
    expect(result.executionStatus).toBe('ok');
  });

  it('per-turn string assertions are evaluated and affect score', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('Paris'),
      assistantResponse('Berlin'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-string-assertions',
      question: 'Geography',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Correct answers',
      mode: 'conversation',
      turns: [
        { input: 'Capital of France?', assertions: ['Response mentions Paris'] },
        { input: 'Capital of Germany?', assertions: ['Response mentions Berlin'] },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(1.0),
      now: nowFn,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(2);
  });

  it('per-turn structured assertions are evaluated', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('42'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-struct-assertions',
      question: 'Math',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Correct',
      mode: 'conversation',
      turns: [
        {
          input: 'What is 6 * 7?',
          assertions: [{ type: 'llm-grader', criteria: 'Answer is 42' }],
        },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(1.0),
      now: nowFn,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(1);
  });

  it('conversation-level assertions are evaluated against full transcript', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('Yes'),
      assistantResponse('No'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-top-level',
      question: 'Consistency check',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Consistent throughout',
      mode: 'conversation',
      turns: [
        { input: 'Turn 1' },
        { input: 'Turn 2' },
      ],
      assertions: [{ type: 'llm-grader', criteria: 'Conversation was coherent' }],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(0.9),
      now: nowFn,
    });

    // Should have per-turn scores plus a conversation-level score
    expect(result.scores).toBeDefined();
    const hasConversationScore = result.scores?.some((s) => s.name === 'conversation');
    expect(hasConversationScore).toBe(true);
  });

  it('aggregation: mean — averages all turn scores', async () => {
    // 3 turns, no per-turn assertions → each scores 1.0
    const provider = new SequenceProvider('mock', [
      assistantResponse('A'),
      assistantResponse('B'),
      assistantResponse('C'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-mean',
      question: 'mean test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      aggregation: 'mean',
      turns: [
        { input: 'T1' },
        { input: 'T2' },
        { input: 'T3' },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(),
      now: nowFn,
    });

    expect(result.score).toBeCloseTo(1.0, 5);
  });

  it('aggregation: min — uses lowest turn score', async () => {
    // Use per-turn assertions so scores are driven by the grader
    // Turn 1: grader returns 1.0, Turn 2: 0.5, Turn 3: 0.8
    let callCount = 0;
    const scores = [1.0, 0.5, 0.8];

    const customRegistry = {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          const s = scores[callCount++] ?? 1.0;
          return {
            score: s,
            verdict: s >= 0.5 ? ('pass' as const) : ('fail' as const),
            assertions: [{ text: 'graded', passed: s >= 0.5 }],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new SequenceProvider('mock', [
      assistantResponse('A'),
      assistantResponse('B'),
      assistantResponse('C'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-min',
      question: 'min test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      aggregation: 'min',
      turns: [
        { input: 'T1', assertions: ['Criterion A'] },
        { input: 'T2', assertions: ['Criterion B'] },
        { input: 'T3', assertions: ['Criterion C'] },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: customRegistry,
      now: nowFn,
    });

    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('aggregation: max — uses highest turn score', async () => {
    let callCount = 0;
    const scores = [1.0, 0.5, 0.8];

    const customRegistry = {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          const s = scores[callCount++] ?? 1.0;
          return {
            score: s,
            verdict: s >= 0.5 ? ('pass' as const) : ('fail' as const),
            assertions: [{ text: 'graded', passed: s >= 0.5 }],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new SequenceProvider('mock', [
      assistantResponse('A'),
      assistantResponse('B'),
      assistantResponse('C'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-max',
      question: 'max test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      aggregation: 'max',
      turns: [
        { input: 'T1', assertions: ['Criterion A'] },
        { input: 'T2', assertions: ['Criterion B'] },
        { input: 'T3', assertions: ['Criterion C'] },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: customRegistry,
      now: nowFn,
    });

    expect(result.score).toBeCloseTo(1.0, 5);
  });

  it('on_turn_failure: stop — skips remaining turns after first failure', async () => {
    let callCount = 0;
    const customRegistry = {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          callCount++;
          // First grader call fails
          return {
            score: 0.0,
            verdict: 'fail' as const,
            assertions: [{ text: 'failed', passed: false }],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new SequenceProvider('mock', [
      assistantResponse('Turn 1 response'),
      assistantResponse('Turn 2 response'),
      assistantResponse('Turn 3 response'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-stop',
      question: 'stop test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      on_turn_failure: 'stop',
      turns: [
        { input: 'T1', assertions: ['Criterion'] },
        { input: 'T2', assertions: ['Criterion'] },
        { input: 'T3', assertions: ['Criterion'] },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: customRegistry,
      now: nowFn,
    });

    // Provider should only be called once (first turn)
    expect(provider.requests).toHaveLength(1);

    // Skipped turns should have score 0 with skip verdict
    const skippedScores = result.scores?.filter((s) => s.verdict === 'skip') ?? [];
    expect(skippedScores.length).toBeGreaterThanOrEqual(2);
  });

  it('on_turn_failure: continue (default) — all turns run even after failure', async () => {
    let callCount = 0;
    const customRegistry = {
      'llm-grader': {
        kind: 'llm-grader' as const,
        async evaluate() {
          callCount++;
          return {
            score: callCount === 1 ? 0.0 : 1.0,
            verdict: callCount === 1 ? ('fail' as const) : ('pass' as const),
            assertions: [{ text: 'graded', passed: callCount !== 1 }],
            expectedAspectCount: 1,
          };
        },
      },
    };

    const provider = new SequenceProvider('mock', [
      assistantResponse('A'),
      assistantResponse('B'),
      assistantResponse('C'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-continue',
      question: 'continue test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      on_turn_failure: 'continue',
      turns: [
        { input: 'T1', assertions: ['Criterion'] },
        { input: 'T2', assertions: ['Criterion'] },
        { input: 'T3', assertions: ['Criterion'] },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: customRegistry,
      now: nowFn,
    });

    // All 3 turns must run
    expect(provider.requests).toHaveLength(3);
    // No skipped turns
    const skippedScores = result.scores?.filter((s) => s.verdict === 'skip') ?? [];
    expect(skippedScores).toHaveLength(0);
  });

  it('window_size — chatPrompt passed to provider is limited to system + last N*2 messages', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('R1'),
      assistantResponse('R2'),
      assistantResponse('R3'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-window',
      question: 'window test',
      input: [{ role: 'system', content: 'System prompt' }],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      window_size: 1, // keep system + last 1 user+assistant pair
      turns: [
        { input: 'T1' },
        { input: 'T2' },
        { input: 'T3' },
      ],
    };

    await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(),
      now: nowFn,
    });

    // Provider called 3 times
    expect(provider.requests).toHaveLength(3);

    // Third call chatPrompt should not include T1's messages (windowed)
    const thirdRequest = provider.requests[2];
    const chatPrompt = thirdRequest?.chatPrompt ?? [];
    // System prompt should always be present
    expect(chatPrompt.some((m) => m.role === 'system')).toBe(true);
    // With window_size=1: system + last 2 messages (T2 user + T2 assistant).
    // T1 user message should NOT be in the windowed prompt
    const userMessages = chatPrompt.filter((m) => m.role === 'user');
    expect(userMessages.length).toBeLessThanOrEqual(1);
  });

  it('provider error on a turn — turn scores 0 and execution continues', async () => {
    const provider = new ErrorOnFirstProvider(assistantResponse('Turn 2 response'));

    const evalCase: EvalTest = {
      id: 'conv-provider-error',
      question: 'error test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Anything',
      mode: 'conversation',
      turns: [
        { input: 'T1' },
        { input: 'T2' },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(),
      now: nowFn,
    });

    // Turn 1 should score 0
    const turn1Score = result.scores?.find((s) => s.name === 'turn-1');
    expect(turn1Score?.score).toBe(0);

    // Turn 2 should still run (continue is default)
    const turn2Score = result.scores?.find((s) => s.name === 'turn-2');
    expect(turn2Score).toBeDefined();
    expect(turn2Score?.score).toBe(1.0);
  });

  it('output contains full conversation transcript with all user and assistant messages', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('Answer 1'),
      assistantResponse('Answer 2'),
    ]);

    const evalCase: EvalTest = {
      id: 'conv-transcript',
      question: 'transcript test',
      input: [],
      expected_output: [],
      file_paths: [],
      criteria: 'Full transcript',
      mode: 'conversation',
      turns: [
        { input: 'Question 1' },
        { input: 'Question 2' },
      ],
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(),
      now: nowFn,
    });

    // Output should have all messages from the conversation
    const output = result.output ?? [];
    const userMessages = output.filter((m) => m.role === 'user');
    const assistantMessages = output.filter((m) => m.role === 'assistant');

    expect(userMessages.length).toBe(2);
    expect(assistantMessages.length).toBe(2);
    expect(assistantMessages[0]?.content).toBe('Answer 1');
    expect(assistantMessages[1]?.content).toBe('Answer 2');
  });

  it('no regression — non-conversation test behaves as before', async () => {
    const provider = new SequenceProvider('mock', [
      assistantResponse('Standard response'),
    ]);

    const evalCase: EvalTest = {
      id: 'standard-test',
      question: 'Standard test',
      input: [{ role: 'user', content: 'Hello' }],
      expected_output: [],
      file_paths: [],
      criteria: 'Helpful',
    };

    const result = await runEvalCase({
      evalCase,
      provider,
      target: baseTarget,
      evaluators: makeEvaluatorRegistry(0.8),
      now: nowFn,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.executionStatus).toBe('ok');
    // Should not have turn-level scores
    const hasTurnScores = result.scores?.some((s) => s.name.startsWith('turn-'));
    expect(hasTurnScores).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('validateEvalFile — conversation mode', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-conv-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects turns without mode: conversation', async () => {
    const filePath = path.join(tempDir, 'turns-no-mode.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    turns:
      - input: Turn 1
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'turns' requires mode: conversation"))).toBe(true);
  });

  it('rejects mode: conversation without turns', async () => {
    const filePath = path.join(tempDir, 'mode-no-turns.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    mode: conversation
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("non-empty 'turns' array"))).toBe(true);
  });

  it('rejects mode: conversation with empty turns array', async () => {
    const filePath = path.join(tempDir, 'mode-empty-turns.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    mode: conversation
    turns: []
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("non-empty 'turns' array"))).toBe(true);
  });

  it('rejects turns + top-level expected_output', async () => {
    const filePath = path.join(tempDir, 'turns-expected-output.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    mode: conversation
    turns:
      - input: Turn 1
    expected_output: "some output"
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'expected_output' is not allowed with mode: conversation"))).toBe(true);
  });

  it('rejects aggregation without mode: conversation', async () => {
    const filePath = path.join(tempDir, 'aggregation-no-mode.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    aggregation: mean
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'aggregation' requires mode: conversation"))).toBe(true);
  });

  it('rejects on_turn_failure without mode: conversation', async () => {
    const filePath = path.join(tempDir, 'on-turn-failure-no-mode.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    on_turn_failure: stop
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'on_turn_failure' requires mode: conversation"))).toBe(true);
  });

  it('rejects window_size without mode: conversation', async () => {
    const filePath = path.join(tempDir, 'window-no-mode.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    window_size: 3
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("'window_size' requires mode: conversation"))).toBe(true);
  });

  it('rejects a turn missing input', async () => {
    const filePath = path.join(tempDir, 'turn-missing-input.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: t1
    criteria: Goal
    input: hello
    mode: conversation
    turns:
      - expected_output: "something"
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('non-empty input'))).toBe(true);
  });

  it('accepts a valid conversation mode eval file', async () => {
    const filePath = path.join(tempDir, 'valid-conversation.yaml');
    await writeFile(
      filePath,
      `tests:
  - id: conv-valid
    criteria: Be helpful
    input: "System: you are a helpful assistant"
    mode: conversation
    aggregation: mean
    on_turn_failure: continue
    window_size: 5
    turns:
      - input: "What is 2+2?"
        expected_output: "4"
      - input: "And 3+3?"
        assertions:
          - "Response mentions 6"
`,
    );
    const result = await validateEvalFile(filePath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
