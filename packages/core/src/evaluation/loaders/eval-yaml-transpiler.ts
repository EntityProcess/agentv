/**
 * EVAL.yaml → evals.json transpiler.
 *
 * Converts an AgentV EVAL.yaml file into Agent Skills evals.json format
 * for consumption by the skill-creator pipeline.
 *
 * Handles canonical `assert:` entries.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseYamlValue } from '../yaml-loader.js';

// ---------------------------------------------------------------------------
// evals.json output types
// ---------------------------------------------------------------------------

export interface EvalsJsonCase {
  id: number;
  prompt: string;
  expected_output?: string;
  files?: string[];
  should_trigger?: boolean;
  assertions: string[];
}

export interface EvalsJsonFile {
  skill_name: string;
  evals: EvalsJsonCase[];
}

// ---------------------------------------------------------------------------
// Raw YAML input types (unvalidated)
// ---------------------------------------------------------------------------

type RawContent =
  | string
  | Array<{ type?: string; value?: string; [key: string]: unknown }>
  | unknown;

interface RawMessage {
  role?: string;
  content?: RawContent;
  [key: string]: unknown;
}

interface RawAssertEntry {
  type?: string;
  skill?: string;
  should_trigger?: boolean;
  criteria?: string;
  value?: unknown;
  metric?: string;
  description?: string;
  command?: unknown;
  prompt?: string;
  rubrics?: unknown[];
  expected?: unknown[];
  fields?: unknown[];
  threshold?: number;
  budget?: number;
  [key: string]: unknown;
}

interface RawTestCase {
  id?: string | number;
  criteria?: string;
  input?: string | RawMessage[] | { [key: string]: unknown };
  input_files?: string[];
  expected_output?: string | RawMessage[] | unknown;
  assert?: RawAssertEntry[];
  [key: string]: unknown;
}

interface RawSuite {
  tests?: RawTestCase[];
  assert?: RawAssertEntry[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Assertion → natural language conversion
// ---------------------------------------------------------------------------

/**
 * Build an NL instruction string for a script grader that tells the grading agent
 * how to execute it via `agentv eval assert`.
 *
 * The `<agent_output>` and `<original_prompt>` placeholders are substituted
 * by the grading agent at evaluation time.
 */
function scriptGraderInstruction(graderName: string, description?: string): string {
  const desc = description ? ` This grader: ${description}.` : '';
  return `Run \`agentv eval assert ${graderName} --agent-output <agent_output> --agent-input <original_prompt>\` and check the result.${desc} The command accepts --agent-output (the agent's full response text) and --agent-input (the original user prompt). It returns JSON on stdout: {"score": 0-1, "reasoning": "..."}. A score >= 0.5 means pass (exit 0); below 0.5 means fail (exit 1).`;
}

/**
 * Derive a grader name from a command array by finding the first argument
 * with a recognised script extension (e.g. `['bun', 'run', '.agentv/graders/format-checker.ts']` → `'format-checker'`).
 */
function deriveGraderNameFromCommand(command: unknown): string | undefined {
  if (!Array.isArray(command) || command.length === 0) return undefined;
  for (const arg of command) {
    if (typeof arg !== 'string') continue;
    const match = arg.match(/([^/]+)\.(ts|js|mts|mjs)$/);
    if (match) return match[1] || undefined;
  }
  return undefined;
}

function assertionToNaturalLanguage(entry: RawAssertEntry): string | null {
  const type = entry.type;

  switch (type) {
    case 'skill-trigger':
      throw new Error(staleSkillTriggerMessage(entry));

    case 'skill-used':
    case 'not-skill-used':
      // Handled separately as Agent Skills trigger labels.
      return null;

    case 'llm-rubric':
      return typeof entry.value === 'string' ? entry.value : null;

    case 'contains':
      return `Output contains '${entry.value}'`;

    case 'contains-any': {
      const values = Array.isArray(entry.value)
        ? (entry.value as string[]).join("', '")
        : entry.value;
      return `Output contains any of: '${values}'`;
    }

    case 'contains-all': {
      const values = Array.isArray(entry.value)
        ? (entry.value as string[]).join("', '")
        : entry.value;
      return `Output contains all of: '${values}'`;
    }

    case 'icontains':
      return `Output contains (case-insensitive) '${entry.value}'`;

    case 'regex':
      return `Output matches regex: ${entry.value}`;

    case 'equals':
      return `Output exactly equals: ${entry.value}`;

    case 'is-json':
      return 'Output is valid JSON';

    case 'starts-with':
      return `Output starts with '${entry.value}'`;

    case 'ends-with':
      return `Output ends with '${entry.value}'`;

    case 'llm-grader':
      // Expand each rubric item to its own assertion string
      // Return the first one — callers handle arrays via assertionToNaturalLanguageList
      if (Array.isArray(entry.rubrics) && entry.rubrics.length > 0) {
        return null; // handled by list expansion below
      }
      return typeof entry.prompt === 'string' ? entry.prompt : null;

    case 'tool-trajectory': {
      const expectedArr = Array.isArray(entry.expected) ? entry.expected : [];
      const tools = (expectedArr as Array<{ tool?: string }>)
        .map((e) => e.tool)
        .filter(Boolean)
        .join(', ');
      return tools
        ? `Agent called tools in order: ${tools}`
        : 'Agent followed expected tool trajectory';
    }

    case 'script': {
      const graderName = entry.metric ?? deriveGraderNameFromCommand(entry.command) ?? 'script';
      const desc = typeof entry.description === 'string' ? entry.description : undefined;
      return scriptGraderInstruction(graderName, desc);
    }

    case 'field-accuracy': {
      const fieldPaths = Array.isArray(entry.fields)
        ? (entry.fields as Array<{ path?: string }>)
            .map((f) => f.path)
            .filter(Boolean)
            .join(', ')
        : '';
      return fieldPaths
        ? `Fields ${fieldPaths} match expected values`
        : 'Fields match expected values';
    }

    case 'latency':
      return typeof entry.threshold === 'number'
        ? `Response time under ${entry.threshold}ms`
        : 'Response time within threshold';

    case 'cost':
      return typeof entry.budget === 'number'
        ? `Cost under $${entry.budget}`
        : 'Cost within budget';

    case 'token-usage':
      return 'Token usage within limits';

    case 'execution-metrics':
      return 'Execution within metric bounds';

    default: {
      // Unknown type with a command -> treat as a script grader.
      if (entry.command !== undefined && type) {
        return scriptGraderInstruction(deriveGraderNameFromCommand(entry.command) ?? type);
      }
      // Fallback: try to produce something readable
      if (typeof entry.criteria === 'string') return entry.criteria;
      if (typeof entry.prompt === 'string') return entry.prompt;
      return type ? `${type} assertion` : null;
    }
  }
}

/**
 * Expand a single assertion entry into zero or more NL strings.
 * Most assertions produce exactly one string; llm-grader with rubrics expands to many.
 */
function assertionToNaturalLanguageList(entry: RawAssertEntry): string[] {
  if (entry.type === 'llm-rubric') {
    if (Array.isArray(entry.value) && entry.value.length > 0) {
      return entry.value
        .map((rubric) => {
          if (typeof rubric === 'string') return rubric;
          if (!rubric || typeof rubric !== 'object') return undefined;
          const item = rubric as { outcome?: string; criteria?: string; id?: string };
          return item.outcome ?? item.criteria ?? item.id;
        })
        .filter((value): value is string => typeof value === 'string');
    }
  }
  if (entry.type === 'llm-grader') {
    if (Array.isArray(entry.rubrics) && entry.rubrics.length > 0) {
      return (entry.rubrics as Array<{ outcome?: string; criteria?: string; id?: string }>)
        .map((r) => r.outcome ?? r.criteria ?? r.id)
        .filter((s): s is string => typeof s === 'string');
    }
  }
  const nl = assertionToNaturalLanguage(entry);
  return nl !== null ? [nl] : [];
}

function staleSkillTriggerMessage(entry: RawAssertEntry): string {
  const skill = typeof entry.skill === 'string' ? entry.skill.trim() : '';
  const shouldTrigger = entry.should_trigger !== false;
  if (!skill) {
    return "Authored assertion type 'skill-trigger' has been removed. Use 'skill-used' with value: <skill> for expected skill use, or 'not-skill-used' with value: <skill> when the skill must not be used.";
  }
  const replacementType = shouldTrigger ? 'skill-used' : 'not-skill-used';
  return `Authored assertion type 'skill-trigger' has been removed. Replace skill: ${skill} with type: ${replacementType}, value: ${skill}.`;
}

interface SkillUseAssertion {
  readonly skill: string;
  readonly shouldTrigger: boolean;
}

function skillNameFromValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  }
  return undefined;
}

function extractSkillUseAssertions(assertions: RawAssertEntry[]): SkillUseAssertion[] {
  return assertions.flatMap((entry) => {
    if (entry.type === 'skill-trigger') {
      throw new Error(staleSkillTriggerMessage(entry));
    }
    if (entry.type !== 'skill-used' && entry.type !== 'not-skill-used') {
      return [];
    }
    const skill = skillNameFromValue(entry.value);
    if (!skill) {
      return [];
    }
    return [{ skill, shouldTrigger: entry.type === 'skill-used' }];
  });
}

// ---------------------------------------------------------------------------
// Input extraction
// ---------------------------------------------------------------------------

interface ExtractedInput {
  prompt: string;
  files: string[];
}

/**
 * Extract prompt text and file paths from a test case input.
 *
 * Supports:
 * - String input → prompt, no files
 * - Message array with role: user and content blocks
 * - input_files shorthand (alongside string or message-array input)
 */
function extractInput(rawCase: RawTestCase): ExtractedInput {
  const files: string[] = Array.isArray(rawCase.input_files)
    ? (rawCase.input_files as string[]).filter((f) => typeof f === 'string')
    : [];

  const input = rawCase.input;

  if (typeof input === 'string') {
    return { prompt: input, files };
  }

  if (Array.isArray(input)) {
    let prompt = '';
    for (const msg of input as RawMessage[]) {
      if (msg.role !== 'user') continue;
      if (typeof msg.content === 'string') {
        prompt = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<{ type?: string; value?: string }>) {
          if (block.type === 'text' && typeof block.value === 'string') prompt = block.value;
          else if (block.type === 'file' && typeof block.value === 'string')
            files.push(block.value);
        }
      }
    }
    return { prompt, files };
  }

  return { prompt: '', files };
}

/**
 * Flatten expected_output to a string.
 * Accepts string, message array (takes last assistant message content),
 * or any other value serialized to JSON.
 */
function extractExpectedOutput(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;

  if (Array.isArray(raw)) {
    // Take the last assistant message content
    for (let i = raw.length - 1; i >= 0; i--) {
      const msg = raw[i] as RawMessage;
      if (typeof msg.content === 'string') return msg.content;
    }
    return undefined;
  }

  return JSON.stringify(raw);
}

// ---------------------------------------------------------------------------
// Transpiler core
// ---------------------------------------------------------------------------

/**
 * Result of transpiling a single EVAL.yaml.
 * May produce multiple evals.json files (one per skill).
 */
export interface TranspileResult {
  /** Map from skill_name → EvalsJsonFile */
  files: Map<string, EvalsJsonFile>;
  /** Warning messages accumulated during transpilation */
  warnings: string[];
}

/**
 * Transpile a parsed EVAL.yaml object into one or more evals.json objects.
 *
 * @param suite  Parsed YAML object (already loaded, no file I/O here)
 * @param source Source identifier for error messages (e.g. file path)
 */
export function transpileEvalYaml(suite: unknown, source = 'EVAL.yaml'): TranspileResult {
  const files = new Map<string, EvalsJsonFile>();

  if (typeof suite !== 'object' || suite === null) {
    throw new Error(`Invalid EVAL.yaml: expected an object in '${source}'`);
  }

  const rawSuite = suite as RawSuite;

  if (!Array.isArray(rawSuite.tests)) {
    throw new Error(`Invalid EVAL.yaml: missing 'tests' array in '${source}'`);
  }

  const suiteAssertions = rawSuite.assert ?? [];

  // Suite-level NL assertions (appended to every test)
  const suiteNlAssertions: string[] = suiteAssertions.flatMap(assertionToNaturalLanguageList);

  /**
   * Helper: get or create the EvalsJsonFile for a skill.
   */
  function getSkillFile(skillName: string): EvalsJsonFile {
    const existing = files.get(skillName);
    if (existing) return existing;
    const created: EvalsJsonFile = { skill_name: skillName, evals: [] };
    files.set(skillName, created);
    return created;
  }

  const tests = rawSuite.tests as RawTestCase[];

  for (let idx = 0; idx < tests.length; idx++) {
    const rawCase = tests[idx];
    const caseAssertions = rawCase.assert ?? [];

    if (
      typeof rawCase.criteria === 'string' &&
      rawCase.criteria.trim() &&
      rawCase.assert !== undefined
    ) {
      throw new Error(
        `Invalid EVAL.yaml test '${rawCase.id ?? idx + 1}' in '${source}': do not combine test-level 'criteria' with 'assert'. Put human-readable case descriptions in 'description', or express grading text as an explicit assertion such as { type: 'llm-rubric', value: ... }.`,
      );
    }

    // Collect NL assertions (not skill-use assertions)
    const nlAssertions: string[] = [];

    // Prepend test-level criteria as NL assertion
    if (typeof rawCase.criteria === 'string' && rawCase.criteria.trim()) {
      nlAssertions.push(rawCase.criteria.trim());
    }

    for (const entry of caseAssertions) {
      if (entry.type !== 'skill-used' && entry.type !== 'not-skill-used') {
        nlAssertions.push(...assertionToNaturalLanguageList(entry));
      }
    }

    // Append suite-level NL assertions
    nlAssertions.push(...suiteNlAssertions);

    const triggerJudges = extractSkillUseAssertions(caseAssertions);
    const { prompt, files: inputFiles } = extractInput(rawCase);
    const expectedOutput = extractExpectedOutput(rawCase.expected_output);

    // Build the numeric id (1-based index)
    const numericId = idx + 1;

    // Build the base case (without should_trigger — added per-skill below)
    const baseCase: Omit<EvalsJsonCase, 'should_trigger'> & { should_trigger?: boolean } = {
      id: numericId,
      prompt,
      ...(expectedOutput !== undefined && { expected_output: expectedOutput }),
      ...(inputFiles.length > 0 && { files: inputFiles }),
      assertions: nlAssertions,
    };

    if (triggerJudges.length === 0) {
      // No skill-use assertion: place in dominant skill (or _no-skill)
      // Determine dominant skill by scanning all tests (first occurrence wins)
      // We defer this: record with a sentinel and resolve after all tests are processed.
      // For now, push to _no-skill; we'll re-assign at the end.
      const noSkillFile = getSkillFile('_no-skill');
      noSkillFile.evals.push({ ...baseCase });
    } else {
      // Place in each skill with the correct should_trigger value
      for (const tj of triggerJudges) {
        const skillFile = getSkillFile(tj.skill);
        skillFile.evals.push({ ...baseCase, should_trigger: tj.shouldTrigger });
      }
    }
  }

  // Re-assign _no-skill tests to the dominant skill (if one exists)
  const noSkillFile = files.get('_no-skill');
  if (noSkillFile && noSkillFile.evals.length > 0) {
    // Find the skill with the most tests (among real skills)
    let dominantSkill: string | null = null;
    let maxCount = 0;
    for (const [name, f] of files) {
      if (name !== '_no-skill' && f.evals.length > maxCount) {
        maxCount = f.evals.length;
        dominantSkill = name;
      }
    }

    if (dominantSkill) {
      const targetFile = getSkillFile(dominantSkill);
      for (const evalCase of noSkillFile.evals) {
        targetFile.evals.push(evalCase);
      }
      files.delete('_no-skill');
    }
    // else: keep _no-skill if there are no other skills
  }

  return { files, warnings: [] };
}

// ---------------------------------------------------------------------------
// File-level API
// ---------------------------------------------------------------------------

/**
 * Transpile an EVAL.yaml file into one or more evals.json objects.
 * Returns a map from output filename → JSON content.
 *
 * @param evalYamlPath  Absolute path to the EVAL.yaml file
 */
export function transpileEvalYamlFile(evalYamlPath: string): TranspileResult {
  const content = readFileSync(evalYamlPath, 'utf8');
  const parsed = parseYamlValue(content);
  return transpileEvalYaml(parsed, path.basename(evalYamlPath));
}

/**
 * Determine the output filename(s) for a transpile result.
 * Single skill → "evals.json"
 * Multiple skills → "<skill>.evals.json"
 */
export function getOutputFilenames(result: TranspileResult): Map<string, string> {
  const names = new Map<string, string>();
  if (result.files.size === 1) {
    for (const [skill] of result.files) {
      names.set(skill, 'evals.json');
    }
  } else {
    for (const [skill] of result.files) {
      const safeName = skill.replace(/[^a-zA-Z0-9_-]/g, '_');
      names.set(skill, `${safeName}.evals.json`);
    }
  }
  return names;
}
