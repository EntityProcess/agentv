#!/usr/bin/env bun
/**
 * Deterministic code grader for the code-grader stdin payload contract.
 *
 * It verifies that AgentV sends the canonical wire payload to code graders:
 * final answer text in `output`, full transcript in `messages`, test context in
 * `input`/`criteria`, and no deprecated `answer` alias.
 */

import { readFileSync } from 'node:fs';

interface Assertion {
  readonly text: string;
  readonly passed: boolean;
  readonly evidence?: string;
}

const assertions: Assertion[] = [];

function push(text: string, passed: boolean, evidence?: string): void {
  assertions.push({ text, passed, ...(evidence ? { evidence } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function collectStrings(value: unknown, strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }
}

let payload: Record<string, unknown>;

try {
  const parsed = JSON.parse(readFileSync('/dev/stdin', 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    push('stdin payload is a JSON object', false, `Received ${typeof parsed}`);
    console.log(JSON.stringify({ assertions }));
    process.exit(0);
  }
  payload = parsed;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  push('stdin payload is valid JSON', false, message);
  console.log(JSON.stringify({ assertions }));
  process.exit(0);
}

const output = payload.output;
const outputIsString = typeof output === 'string';
push(
  'output is the final answer string',
  outputIsString,
  outputIsString
    ? undefined
    : `Expected string, got ${Array.isArray(output) ? 'array' : typeof output}`,
);

const outputText = outputIsString ? output : '';
push(
  'output contains the agent answer',
  outputText.trim().length > 0 && outputText.includes('CONTRACT'),
  outputText.trim().length > 0
    ? `output=${JSON.stringify(outputText.slice(0, 80))}`
    : 'output was empty',
);

const messages = payload.messages;
const messagesIsArray = Array.isArray(messages);
push(
  'messages is the full transcript array',
  messagesIsArray,
  messagesIsArray ? undefined : `Expected array, got ${typeof messages}`,
);

const hasAssistantMessage =
  messagesIsArray && messages.some((message) => isRecord(message) && message.role === 'assistant');
push(
  'messages contains an assistant message',
  hasAssistantMessage,
  hasAssistantMessage ? undefined : 'No assistant role message found in messages',
);

const inputStrings: string[] = [];
collectStrings(payload.input, inputStrings);
const inputIncludesOriginalRequest = inputStrings.some((text) => text.includes('CONTRACT'));
push(
  'input contains the original user request',
  inputIncludesOriginalRequest,
  inputIncludesOriginalRequest ? undefined : 'CONTRACT marker not found in input',
);

const criteria = payload.criteria;
push(
  'criteria contains the test criteria',
  typeof criteria === 'string' && criteria.includes('CONTRACT'),
  typeof criteria === 'string' ? `criteria=${JSON.stringify(criteria)}` : 'criteria was missing',
);

const camelCaseKeys = [
  'expectedOutput',
  'inputFiles',
  'outputPath',
  'traceSummary',
  'workspacePath',
  'costUsd',
  'durationMs',
  'startTime',
  'endTime',
  'fileChanges',
];
const leakedCamelCaseKeys = camelCaseKeys.filter((key) => hasOwn(payload, key));
push(
  'grader payload uses snake_case wire keys',
  Array.isArray(payload.input_files) && leakedCamelCaseKeys.length === 0,
  leakedCamelCaseKeys.length > 0
    ? `Unexpected camelCase keys: ${leakedCamelCaseKeys.join(', ')}`
    : Array.isArray(payload.input_files)
      ? undefined
      : 'input_files was missing or not an array',
);

push(
  'deprecated answer alias is absent',
  !hasOwn(payload, 'answer'),
  hasOwn(payload, 'answer') ? 'Unexpected answer field found in payload' : undefined,
);

console.log(JSON.stringify({ assertions }));
