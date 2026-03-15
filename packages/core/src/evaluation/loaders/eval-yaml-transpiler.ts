/**
 * EVAL.yaml → evals.json transpiler.
 *
 * Converts an AgentV EVAL.yaml file into Agent Skills evals.json format
 * for consumption by the skill-creator pipeline.
 *
 * Handles both `assertions:` (current) and `assert:` (deprecated alias).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

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
  value?: string;
  name?: string;
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
  assertions?: RawAssertEntry[];
  /** @deprecated Use `assertions` instead */
  assert?: RawAssertEntry[];
  [key: string]: unknown;
}

interface RawSuite {
  tests?: RawTestCase[];
  assertions?: RawAssertEntry[];
  /** @deprecated Use `assertions` instead */
  assert?: RawAssertEntry[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Assertion → natural language conversion
// ---------------------------------------------------------------------------

/**
 * Build an NL instruction string for a code judge that tells the grader agent
 * how to execute it via `agentv eval run-judge`.
 *
 * The `<agent_output>` and `<original_prompt>` placeholders are substituted
 * by the grading agent at evaluation time.
 */
function codeJudgeInstruction(judgeName: string, description?: string): string {
  const desc = description ? ` This judge: ${description}.` : '';
  return (
    `Run \`agentv eval run-judge ${judgeName} --output <agent_output> --input <original_prompt>\` and check the result.${desc} ` +
    `The command accepts --output (the agent's full response text) and --input (the original user prompt). ` +
    `It returns JSON on stdout: {"score": 0-1, "reasoning": "..."}. A score of 1.0 means pass; 0 means fail.`
  );
}

/**
 * Derive a judge name from a command array by extracting the filename stem
 * of the last path-like argument (e.g. `['bun', 'run', '.agentv/judges/format-checker.ts']` → `'format-checker'`).
 */
function deriveJudgeNameFromCommand(command: unknown): string | undefined {
  if (!Array.isArray(command) || command.length === 0) return undefined;
  const last = command[command.length - 1];
  if (typeof last !== 'string') return undefined;
  const basename = last.split('/').pop() ?? last;
  return basename.replace(/\.(ts|js|mts|mjs)$/, '') || undefined;
}

function assertionToNaturalLanguage(entry: RawAssertEntry): string | null {
  const type = entry.type;

  switch (type) {
    case 'skill-trigger':
      // Handled separately — not an NL assertion
      return null;

    case 'rubrics': {
      // criteria may be a string (NL) or array of rubric items
      if (typeof entry.criteria === 'string') {
        return entry.criteria;
      }
      return null;
    }

    case 'contains':
      return `Output contains '${entry.value}'`;

    case 'contains-any':
    case 'contains_any': {
      const values = Array.isArray(entry.value)
        ? (entry.value as string[]).join("', '")
        : entry.value;
      return `Output contains any of: '${values}'`;
    }

    case 'contains-all':
    case 'contains_all': {
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
    case 'is_json':
      return 'Output is valid JSON';

    case 'starts-with':
    case 'starts_with':
      return `Output starts with '${entry.value}'`;

    case 'ends-with':
    case 'ends_with':
      return `Output ends with '${entry.value}'`;

    case 'llm-judge':
    case 'llm_judge':
      return typeof entry.prompt === 'string' ? entry.prompt : null;

    case 'agent-judge':
    case 'agent_judge': {
      // Expand each rubric item to its own assertion string
      // Return the first one — callers handle arrays via assertionToNaturalLanguageList
      if (Array.isArray(entry.rubrics) && entry.rubrics.length > 0) {
        return null; // handled by list expansion below
      }
      return typeof entry.prompt === 'string' ? entry.prompt : null;
    }

    case 'tool-trajectory':
    case 'tool_trajectory': {
      const expectedArr = Array.isArray(entry.expected) ? entry.expected : [];
      const tools = (expectedArr as Array<{ tool?: string }>)
        .map((e) => e.tool)
        .filter(Boolean)
        .join(', ');
      return tools
        ? `Agent called tools in order: ${tools}`
        : 'Agent followed expected tool trajectory';
    }

    case 'code-judge':
    case 'code_judge': {
      const judgeName =
        entry.name ?? deriveJudgeNameFromCommand(entry.command) ?? 'code-judge';
      const desc = typeof entry.description === 'string' ? entry.description : undefined;
      return codeJudgeInstruction(judgeName, desc);
    }

    case 'field-accuracy':
    case 'field_accuracy': {
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
    case 'token_usage':
      return 'Token usage within limits';

    case 'execution-metrics':
    case 'execution_metrics':
      return 'Execution within metric bounds';

    default: {
      // Unknown type with a command → treat as code judge
      if (entry.command !== undefined && type) {
        return codeJudgeInstruction(type);
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
 * Most assertions produce exactly one string; agent-judge with rubrics expands to many.
 */
function assertionToNaturalLanguageList(entry: RawAssertEntry): string[] {
  if (entry.type === 'agent-judge' || entry.type === 'agent_judge') {
    if (Array.isArray(entry.rubrics) && entry.rubrics.length > 0) {
      return (entry.rubrics as Array<{ outcome?: string; criteria?: string; id?: string }>)
        .map((r) => r.outcome ?? r.criteria ?? r.id)
        .filter((s): s is string => typeof s === 'string');
    }
  }
  const nl = assertionToNaturalLanguage(entry);
  return nl !== null ? [nl] : [];
}

/**
 * Extract skill-trigger entries from an assertion list.
 * Returns entries with type === 'skill-trigger'.
 */
function extractTriggerJudges(assertions: RawAssertEntry[]): RawAssertEntry[] {
  return assertions.filter((a) => a.type === 'skill-trigger');
}

/**
 * Collect all assertion entries for a test case, accepting both
 * `assertions` and deprecated `assert` key.
 */
function resolveAssertions(rawCase: RawTestCase): RawAssertEntry[] {
  if (Array.isArray(rawCase.assertions)) return rawCase.assertions;
  if (Array.isArray(rawCase.assert)) return rawCase.assert;
  return [];
}

/**
 * Collect suite-level assertions (applied to every test).
 */
function resolveSuiteAssertions(suite: RawSuite): RawAssertEntry[] {
  if (Array.isArray(suite.assertions)) return suite.assertions;
  if (Array.isArray(suite.assert)) return suite.assert;
  return [];
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
  const warnings: string[] = [];
  const files = new Map<string, EvalsJsonFile>();

  if (typeof suite !== 'object' || suite === null) {
    throw new Error(`Invalid EVAL.yaml: expected an object in '${source}'`);
  }

  const rawSuite = suite as RawSuite;

  if (!Array.isArray(rawSuite.tests)) {
    throw new Error(`Invalid EVAL.yaml: missing 'tests' array in '${source}'`);
  }

  if (rawSuite.assert !== undefined && rawSuite.assertions === undefined) {
    warnings.push("'assert' is deprecated at the suite level. Use 'assertions' instead.");
  }

  const suiteAssertions = resolveSuiteAssertions(rawSuite);

  // Suite-level NL assertions (appended to every test)
  const suiteNlAssertions: string[] = suiteAssertions
    .filter((a) => a.type !== 'skill-trigger')
    .flatMap(assertionToNaturalLanguageList);

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
    const caseAssertions = resolveAssertions(rawCase);

    if (rawCase.assert !== undefined && rawCase.assertions === undefined) {
      const caseId = rawCase.id ?? idx + 1;
      warnings.push(`Test '${caseId}': 'assert' is deprecated. Use 'assertions' instead.`);
    }

    // Collect NL assertions (not skill-trigger)
    const nlAssertions: string[] = [];

    // Prepend test-level criteria as NL assertion
    if (typeof rawCase.criteria === 'string' && rawCase.criteria.trim()) {
      nlAssertions.push(rawCase.criteria.trim());
    }

    for (const entry of caseAssertions) {
      if (entry.type !== 'skill-trigger') {
        nlAssertions.push(...assertionToNaturalLanguageList(entry));
      }
    }

    // Append suite-level NL assertions
    nlAssertions.push(...suiteNlAssertions);

    const triggerJudges = extractTriggerJudges(caseAssertions);
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
      // No skill-trigger: place in dominant skill (or _no-skill)
      // Determine dominant skill by scanning all tests (first occurrence wins)
      // We defer this: record with a sentinel and resolve after all tests are processed.
      // For now, push to _no-skill; we'll re-assign at the end.
      const noSkillFile = getSkillFile('_no-skill');
      noSkillFile.evals.push({ ...baseCase });
    } else {
      // Place in each skill with the correct should_trigger value
      for (const tj of triggerJudges) {
        const skillName = typeof tj.skill === 'string' ? tj.skill : '_no-skill';
        const shouldTrigger = tj.should_trigger !== false; // default true
        const skillFile = getSkillFile(skillName);
        skillFile.evals.push({ ...baseCase, should_trigger: shouldTrigger });
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

  return { files, warnings };
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
  const parsed = parse(content) as unknown;
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
