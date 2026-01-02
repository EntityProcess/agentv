import fs from 'node:fs';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type EvalInput = {
  readonly inputMessages?: unknown;
  readonly expectedMessages?: unknown;
  readonly candidateAnswer?: unknown;
};

function findExpectedDecisionFromExpectedMessages(expectedMessages: unknown): string | undefined {
  if (!Array.isArray(expectedMessages)) return undefined;

  for (const msg of expectedMessages) {
    if (!isObject(msg)) continue;
    const content = (msg as Record<string, unknown>).content;
    if (!isObject(content)) continue;

    const decision = (content as Record<string, unknown>).decision;
    if (typeof decision === 'string' && decision.trim().length > 0) {
      return decision.trim();
    }
  }

  return undefined;
}

function findExpectedDecision(inputMessages: unknown): string | undefined {
  if (!Array.isArray(inputMessages)) return undefined;

  for (const msg of inputMessages) {
    if (!isObject(msg)) continue;
    if (msg.role !== 'user') continue;
    const content = msg.content;
    if (!isObject(content)) continue;

    const expected = content.expected;
    if (!isObject(expected)) continue;

    const decision = expected.decision;
    if (typeof decision === 'string' && decision.trim().length > 0) {
      return decision.trim();
    }
  }

  return undefined;
}

function main(): void {
  const stdin = fs.readFileSync(0, 'utf8');
  const input = JSON.parse(stdin) as EvalInput;

  const expectedDecision =
    findExpectedDecisionFromExpectedMessages(input.expectedMessages) ??
    findExpectedDecision(input.inputMessages);
  const candidate = typeof input.candidateAnswer === 'string' ? input.candidateAnswer : '';

  let candidateObj: unknown;
  try {
    candidateObj = JSON.parse(candidate);
  } catch {
    candidateObj = undefined;
  }

  const candidateDecision =
    isObject(candidateObj) && typeof candidateObj.decision === 'string'
      ? candidateObj.decision
      : undefined;

  const hits: string[] = [];
  const misses: string[] = [];

  if (!expectedDecision) {
    misses.push('Missing expected decision (expectedMessages[].content.decision)');
  } else {
    hits.push(`expected.decision present: ${expectedDecision}`);
  }

  if (!candidateDecision) {
    misses.push('Candidate output is not valid JSON with a decision field');
  } else {
    hits.push(`candidate.decision present: ${candidateDecision}`);
  }

  const ok =
    typeof expectedDecision === 'string' &&
    typeof candidateDecision === 'string' &&
    expectedDecision === candidateDecision;

  if (!ok) {
    misses.push(
      `decision mismatch: expected=${expectedDecision ?? 'null'} actual=${candidateDecision ?? 'null'}`,
    );
  }

  const score = ok ? 1 : 0;

  process.stdout.write(
    JSON.stringify({
      score,
      hits,
      misses,
      reasoning: ok
        ? 'Batch runner decision matches the expected decision.'
        : 'Batch runner decision did not match expected decision.',
    }),
  );
}

main();
