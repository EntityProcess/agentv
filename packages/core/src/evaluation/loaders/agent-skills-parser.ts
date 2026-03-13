import { readFile } from 'node:fs/promises';

import type { EvalTest, EvaluatorConfig } from '../types.js';

const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

function logError(msg: string): void {
  console.error(`${ANSI_RED}Error: ${msg}${ANSI_RESET}`);
}

/**
 * Raw Agent Skills evals.json schema.
 * @see https://agentskills.io/skill-creation/evaluating-skills
 */
interface AgentSkillsEvalsFile {
  readonly skill_name?: string;
  readonly evals: readonly AgentSkillsEvalCase[];
}

interface AgentSkillsEvalCase {
  readonly id: number;
  readonly prompt: string;
  readonly expected_output?: string;
  readonly files?: readonly string[];
  readonly assertions?: readonly string[];
}

/**
 * Detect whether a JSON file is in Agent Skills evals.json format.
 * Returns true if the parsed content has an `evals` array.
 */
export function isAgentSkillsFormat(parsed: unknown): parsed is AgentSkillsEvalsFile {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.evals);
}

/**
 * Load and parse an Agent Skills evals.json file into AgentV EvalTest[].
 *
 * Promotion rules:
 * - id (number) → id (string)
 * - prompt → input: [{role: "user", content: prompt}]
 * - expected_output → expected_output: [{role: "assistant", content}] as JsonObject[]
 * - assertions (string[]) → assertions: EvaluatorConfig[] (each → llm-judge)
 * - files → metadata.agent_skills_files (resolved by #541)
 * - skill_name → metadata.skill_name
 */
export async function loadTestsFromAgentSkills(filePath: string): Promise<readonly EvalTest[]> {
  const raw = await readFile(filePath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid Agent Skills evals.json: failed to parse JSON in '${filePath}'`);
  }

  return parseAgentSkillsEvals(parsed, filePath);
}

/**
 * Parse already-loaded Agent Skills evals data into EvalTest[].
 * Exported for testing without file I/O.
 */
export function parseAgentSkillsEvals(parsed: unknown, source = 'evals.json'): readonly EvalTest[] {
  if (!isAgentSkillsFormat(parsed)) {
    throw new Error(`Invalid Agent Skills evals.json: missing 'evals' array in '${source}'`);
  }

  const { evals, skill_name } = parsed;

  if (evals.length === 0) {
    throw new Error(`Invalid Agent Skills evals.json: 'evals' array is empty in '${source}'`);
  }

  const tests: EvalTest[] = [];

  for (const evalCase of evals) {
    const id = evalCase.id;

    if (typeof evalCase.prompt !== 'string' || evalCase.prompt.trim() === '') {
      const caseRef = id !== undefined ? `id=${id}` : 'unknown';
      logError(`Skipping eval case ${caseRef} in '${source}': missing or empty 'prompt'`);
      continue;
    }

    // Promote assertions → llm-judge evaluators
    let assertions: readonly EvaluatorConfig[] | undefined;
    if (evalCase.assertions && evalCase.assertions.length > 0) {
      assertions = evalCase.assertions.map(
        (text, i): EvaluatorConfig => ({
          name: `assertion-${i + 1}`,
          type: 'llm-judge',
          prompt: text,
        }),
      );
    }

    // Build metadata
    const metadata: Record<string, unknown> = {};
    if (skill_name) {
      metadata.skill_name = skill_name;
    }
    if (evalCase.files && evalCase.files.length > 0) {
      metadata.agent_skills_files = evalCase.files;
    }

    const prompt = evalCase.prompt;

    const test: EvalTest = {
      id: String(id),
      question: prompt,
      input: [{ role: 'user', content: prompt }],
      input_segments: [{ type: 'text', value: prompt }],
      expected_output: evalCase.expected_output
        ? [{ role: 'assistant', content: evalCase.expected_output }]
        : [],
      reference_answer: evalCase.expected_output,
      guideline_paths: [],
      file_paths: [],
      criteria: evalCase.expected_output ?? '',
      assertions,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    tests.push(test);
  }

  return tests;
}
