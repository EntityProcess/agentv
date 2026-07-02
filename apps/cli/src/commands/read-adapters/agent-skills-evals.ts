import { readFileSync } from 'node:fs';

interface AgentSkillsEvalsFile {
  readonly skill_name: string;
  readonly evals: readonly unknown[];
}

export interface AgentSkillsCriterion {
  readonly id: string;
  readonly outcome: string;
  readonly required: true;
}

export interface ConvertedAgentSkillsTest {
  readonly id: string;
  readonly prompt: string;
  readonly expectedOutcome?: string;
  readonly criteria: readonly AgentSkillsCriterion[];
  readonly files: readonly string[];
  readonly metadata: Record<string, unknown>;
}

export interface ConvertedAgentSkillsSuite {
  readonly skillName: string;
  readonly tests: readonly ConvertedAgentSkillsTest[];
}

export interface AgentVYamlObject {
  readonly description: string;
  readonly tags: Record<string, string>;
  readonly metadata: Record<string, unknown>;
  readonly tests: readonly Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isAgentSkillsEvalsFormat(parsed: unknown): parsed is AgentSkillsEvalsFile {
  return (
    isRecord(parsed) &&
    typeof parsed.skill_name === 'string' &&
    parsed.skill_name.trim().length > 0 &&
    Array.isArray(parsed.evals)
  );
}

function normalizedStringArray(value: unknown): readonly string[] {
  return isStringArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

export function parseAgentSkillsEvals(
  parsed: unknown,
  source: string,
): ConvertedAgentSkillsSuite {
  if (!isAgentSkillsEvalsFormat(parsed)) {
    throw new Error(
      "Not a valid Agent Skills evals.json: expected top-level 'skill_name' string and 'evals' array",
    );
  }

  if (parsed.evals.length === 0) {
    throw new Error(`Invalid Agent Skills evals.json: 'evals' array is empty in '${source}'`);
  }

  const skillName = parsed.skill_name.trim();
  const tests = parsed.evals.map((rawCase, index): ConvertedAgentSkillsTest => {
    if (!isRecord(rawCase)) {
      throw new Error(`Invalid Agent Skills evals.json: evals[${index}] must be an object`);
    }

    if (typeof rawCase.prompt !== 'string' || rawCase.prompt.trim() === '') {
      throw new Error(
        `Invalid Agent Skills evals.json: evals[${index}].prompt must be a non-empty string`,
      );
    }

    const id = rawCase.id === undefined ? String(index + 1) : String(rawCase.id);
    const expectedOutcome =
      typeof rawCase.expected_output === 'string' && rawCase.expected_output.trim().length > 0
        ? rawCase.expected_output.trim()
        : undefined;
    const assertions = normalizedStringArray(rawCase.assertions);
    const expectations = normalizedStringArray(rawCase.expectations);
    const files = normalizedStringArray(rawCase.files);
    const criteria: AgentSkillsCriterion[] = [];

    if (expectedOutcome) {
      criteria.push({
        id: 'expected-outcome',
        outcome: expectedOutcome,
        required: true,
      });
    }

    for (const [assertionIndex, assertion] of assertions.entries()) {
      criteria.push({
        id: `assertion-${assertionIndex + 1}`,
        outcome: assertion,
        required: true,
      });
    }

    for (const [expectationIndex, expectation] of expectations.entries()) {
      criteria.push({
        id: `expectation-${expectationIndex + 1}`,
        outcome: expectation,
        required: true,
      });
    }

    const metadata: Record<string, unknown> = {};
    if (typeof rawCase.name === 'string' && rawCase.name.trim().length > 0) {
      metadata.agent_skills_name = rawCase.name.trim();
    }
    if (rawCase.id !== undefined) {
      metadata.agent_skills_id = rawCase.id;
    }
    if (files.length > 0) {
      metadata.agent_skills_files = files;
    }

    return {
      id,
      prompt: rawCase.prompt,
      ...(expectedOutcome ? { expectedOutcome } : {}),
      criteria,
      files,
      metadata,
    };
  });

  return { skillName, tests };
}

export function readAgentSkillsEvalsFile(filePath: string): ConvertedAgentSkillsSuite {
  const content = readFileSync(filePath, 'utf8');
  return parseAgentSkillsEvals(JSON.parse(content), filePath);
}

export function isAgentSkillsEvalsJsonFile(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8');
    return isAgentSkillsEvalsFormat(JSON.parse(content));
  } catch {
    return false;
  }
}

export function agentSkillsToAgentVYamlObject(
  suite: ConvertedAgentSkillsSuite,
): AgentVYamlObject {
  return {
    description: `Evals for ${suite.skillName} skill`,
    tags: {
      skill: suite.skillName,
    },
    metadata: {
      source_adapter: 'agent-skills-evals-json',
    },
    tests: suite.tests.map((test) => ({
      id: test.id,
      ...(test.expectedOutcome ? { criteria: test.expectedOutcome } : {}),
      ...(test.files.length > 0 ? { input_files: [...test.files] } : {}),
      input: test.prompt,
      ...(test.criteria.length > 0
        ? {
            assertions: [
              {
                name: 'agent-skills-criteria',
                type: 'g-eval',
                criteria: test.criteria.map((criterion) => ({ ...criterion })),
              },
            ],
          }
        : {}),
      ...(Object.keys(test.metadata).length > 0 ? { metadata: test.metadata } : {}),
    })),
  };
}
