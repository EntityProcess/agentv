import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadTestSuite } from '@agentv/core';
import YAML from 'yaml';
import type {
  AgentVMessage,
  AgentVSource,
  JsonObject,
  NormalizedAssertion,
  NormalizedCase,
  NormalizedSuite,
} from './types.js';

function parseStructuredFile(filePath: string): unknown {
  const content = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) return JSON.parse(content);
  if (filePath.endsWith('.jsonl')) {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return YAML.parse(content);
}

function normalizeAssertion(assertion: unknown, index: number): NormalizedAssertion {
  if (typeof assertion === 'string') {
    return { type: 'rubrics', source: assertion };
  }
  const record = (assertion ?? {}) as JsonObject;
  const type = String(record.type ?? record.name ?? `assertion-${index + 1}`);
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    type,
    source: assertion,
  };
}

function normalizeExpectedOutput(test: {
  readonly reference_answer?: string;
  readonly expected_output?: unknown;
}): unknown {
  const expectedOutput = test.expected_output;
  const hasExpectedOutput = Array.isArray(expectedOutput)
    ? expectedOutput.length > 0
    : expectedOutput !== undefined;
  if (!hasExpectedOutput) return undefined;
  return test.reference_answer ?? expectedOutput;
}

function deriveAgentVRoot(source: AgentVSource): string {
  return path.resolve(source.path, ...source.relativePath.split('/').map(() => '..'));
}

function collectUnsupported(
  raw: JsonObject,
  suite: Awaited<ReturnType<typeof loadTestSuite>>,
): readonly string[] {
  const unsupported: string[] = [];
  for (const key of ['workspace', 'before_all', 'after_all', 'matrix']) {
    if (raw[key] !== undefined) unsupported.push(key);
  }
  if (suite.trials !== undefined) unsupported.push('trials');
  if (suite.workspacePath !== undefined) unsupported.push('workspace');
  if ((suite.targets?.length ?? 0) > 0 || (suite.targetRefs?.length ?? 0) > 0)
    unsupported.push('matrix');
  return [...new Set(unsupported)];
}

/**
 * Load an AgentV-authored eval source into the Phoenix adapter's normalized shape.
 *
 * AgentV eval YAML remains the source of truth: this adapter delegates case expansion,
 * external case files, assertion parsing, Agent Skills `evals.json`, interpolation, and
 * metadata handling to `@agentv/core`'s loader, then normalizes the result for
 * the legacy Phoenix mapping fixture. This is not an AgentV-to-Phoenix completed
 * run export path; keep production Phoenix work read-only through external_trace
 * correlation.
 */
export async function loadAgentVEvalSuite(source: AgentVSource): Promise<NormalizedSuite> {
  if (!existsSync(source.path)) {
    throw new Error(`AgentV eval source does not exist: ${source.path}`);
  }

  const raw = (parseStructuredFile(source.path) ?? {}) as JsonObject;
  const loaded = await loadTestSuite(source.path, deriveAgentVRoot(source));
  const suiteName =
    raw.skill_name ??
    loaded.tests[0]?.suite ??
    raw.name ??
    path.basename(source.path).replace(/\.ya?ml$/, '');

  const cases = loaded.tests.map((test, index): NormalizedCase => {
    const assertions = (test.assertions ?? []).map((assertion, assertionIndex) =>
      normalizeAssertion(assertion, assertionIndex),
    );

    return {
      id: String(test.id ?? `case-${index + 1}`),
      criteria: test.criteria || undefined,
      input: test.input as readonly AgentVMessage[],
      expectedOutput: normalizeExpectedOutput(test),
      assertions,
      metadata: {
        ...(test.metadata ?? {}),
        ...(test.targets ? { targets: test.targets } : {}),
      },
      sourcePath: source.relativePath,
    };
  });

  return {
    name: String(suiteName),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    source,
    cases,
    suiteAssertions: [],
    warnings: cases
      .filter((testCase) => testCase.input.length === 0)
      .map((testCase) => `${source.relativePath}: ${testCase.id} has no input`),
    unsupportedFeatures: collectUnsupported(raw, loaded),
  };
}
