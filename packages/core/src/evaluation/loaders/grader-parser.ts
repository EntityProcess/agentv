import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizePreprocessorType } from '../content-preprocessor.js';
import { interpolateEnv } from '../interpolation.js';
import type { ToolTrajectoryExpectedItem, ToolTrajectoryGraderConfig } from '../trace.js';
import type {
  ContentPreprocessorConfig,
  EvalSourceReference,
  GraderConfig,
  GraderKind,
  JsonObject,
  JsonValue,
  RubricOperator,
  TrajectoryGraderKind,
} from '../types.js';
import { RUBRIC_OPERATOR_VALUES, isGraderKind } from '../types.js';
import { validateCustomPromptContent } from '../validation/prompt-validator.js';
import { parseYamlValue } from '../yaml-loader.js';
import { resolveFileReference } from './file-resolver.js';
import { parseTransformSpec } from './transform-parser.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';
const MAX_ASSERTION_INCLUDE_DEPTH = 3;

/**
 * Prefix for explicit file references in prompt strings.
 * Consistent with case-file-loader.ts which uses "file://" for test-case file references.
 *
 * Usage:
 *   prompt: "file://prompts/grader.md"   → explicit file, error if not found
 *   prompt: "grader.md"                  → inline text (never resolved as file)
 *   prompt: "Evaluate the response"      → inline text
 */
const PROMPT_FILE_PREFIX = 'file://';

export function normalizeGraderType(type: string): string {
  return type;
}

function removedGraderReplacement(type: string): string | undefined {
  const replacements: Record<string, string> = {
    'script-grader': 'script',
    'code-judge': 'script',
    'g-eval': 'llm-rubric',
    rubrics: 'llm-rubric with value',
    rubric: 'llm-rubric with value',
    code_grader: 'script',
    code_judge: 'script',
    composite: 'assert-set',
    llm_judge: 'llm-grader',
    llm_grader: 'llm-grader',
    tool_trajectory: 'tool-trajectory',
    field_accuracy: 'field-accuracy',
    token_usage: 'token-usage',
    execution_metrics: 'execution-metrics',
    contains_any: 'contains-any',
    contains_all: 'contains-all',
    icontains_any: 'icontains-any',
    icontains_all: 'icontains-all',
    starts_with: 'starts-with',
    ends_with: 'ends-with',
    is_json: 'is-json',
  };
  return replacements[type];
}

const UNSUPPORTED_PROMPTFOO_ASSERTION_TYPES = new Set([
  'agent-rubric',
  'answer-relevance',
  'bleu',
  'classifier',
  'contains-html',
  'contains-json',
  'contains-sql',
  'contains-xml',
  'context-faithfulness',
  'context-recall',
  'context-relevance',
  'conversation-relevance',
  'factuality',
  'finish-reason',
  'gleu',
  'guardrails',
  'is-html',
  'is-refusal',
  'is-sql',
  'is-valid-function-call',
  'is-valid-openai-function-call',
  'is-valid-openai-tools-call',
  'is-xml',
  'levenshtein',
  'meteor',
  'model-graded-closedqa',
  'model-graded-factuality',
  'moderation',
  'perplexity',
  'perplexity-score',
  'pi',
  'rouge-n',
  'ruby',
  'similar:cosine',
  'similar:dot',
  'similar:euclidean',
  'select-best',
  'human',
  'max-score',
  'tool-call-f1',
  'trace-error-spans',
  'trace-span-count',
  'trace-span-duration',
  'search-rubric',
  'word-count',
]);

const TRAJECTORY_GRADER_TYPES = new Set<string>([
  'trajectory:tool-used',
  'trajectory:tool-args-match',
  'trajectory:tool-sequence',
  'trajectory:step-count',
  'trajectory:goal-success',
]);

function isTrajectoryGraderKind(value: string): value is TrajectoryGraderKind {
  return TRAJECTORY_GRADER_TYPES.has(value);
}

function formatJsonValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasToolTrajectoryLatencyCheck(rawEvaluator: JsonObject): boolean {
  const expected = rawEvaluator.expected;
  return (
    Array.isArray(expected) &&
    expected.some(
      (item) =>
        isJsonObject(item) &&
        (item.max_duration_ms !== undefined || item.maxDurationMs !== undefined),
    )
  );
}

function staleSkillTriggerMessage(rawEvaluator: JsonObject): string {
  const skillName = asString(rawEvaluator.skill);
  const shouldTrigger = rawEvaluator.should_trigger !== false;
  if (!skillName) {
    return "Authored assertion type 'skill-trigger' has been removed. Use 'skill-used' with value: <skill> for expected skill use, or 'not-skill-used' with value: <skill> when the skill must not be used.";
  }
  const replacementType = shouldTrigger ? 'skill-used' : 'not-skill-used';
  return `Authored assertion type 'skill-trigger' has been removed. Replace skill: ${skillName} with type: ${replacementType}, value: ${skillName}.`;
}

function staleToolTrajectoryMessage(rawEvaluator: JsonObject): string {
  const mode = asString(rawEvaluator.mode);
  if (hasToolTrajectoryLatencyCheck(rawEvaluator)) {
    return "Authored assertion type 'tool-trajectory' has been removed. Per-tool latency checks such as max_duration_ms have no Promptfoo trajectory:* equivalent in AgentV yet; use a custom script assertion or track this as unsupported future scope.";
  }

  if (mode === 'any_order' && isJsonObject(rawEvaluator.minimums)) {
    const entries = Object.entries(rawEvaluator.minimums);
    const [toolName, min] = entries[0] ?? [];
    const example =
      typeof toolName === 'string'
        ? ` For example: type: trajectory:tool-used, value: { name: ${toolName}, min: ${formatJsonValue(min)} }.`
        : '';
    return `Authored assertion type 'tool-trajectory' has been removed. Replace mode: any_order minimums with one Promptfoo trajectory:tool-used assertion per tool.${example}`;
  }

  if ((mode === 'in_order' || mode === 'exact') && Array.isArray(rawEvaluator.expected)) {
    const steps = rawEvaluator.expected
      .filter(isJsonObject)
      .map((item) => item.tool)
      .filter((tool): tool is string => typeof tool === 'string');
    const hasArgs = rawEvaluator.expected.some(
      (item) => isJsonObject(item) && item.args !== undefined && item.args !== 'any',
    );
    const sequenceHint =
      steps.length > 0
        ? ` Use type: trajectory:tool-sequence, value: { mode: ${mode}, steps: ${formatJsonValue(steps)} }.`
        : ' Use type: trajectory:tool-sequence with value: { mode, steps }.';
    const argsHint = hasArgs
      ? ' Move expected args checks to trajectory:tool-args-match with Promptfoo mode: partial or exact.'
      : '';
    return `Authored assertion type 'tool-trajectory' has been removed.${sequenceHint}${argsHint}`;
  }

  return "Authored assertion type 'tool-trajectory' has been removed. Use Promptfoo trajectory:* assertions: trajectory:tool-used for tool presence/counts, trajectory:tool-sequence for in_order/exact steps, and trajectory:tool-args-match for argument checks. AgentV-specific latency checks are unsupported future scope.";
}

function staleAuthoredGraderMessage(rawEvaluator: JsonObject): string | undefined {
  const rawType = rawEvaluator.type;
  if (typeof rawType !== 'string') {
    return undefined;
  }
  const type = rawType.replace(/_/g, '-');
  if (type === 'skill-trigger') {
    return staleSkillTriggerMessage(rawEvaluator);
  }
  if (type === 'tool-trajectory') {
    return staleToolTrajectoryMessage(rawEvaluator);
  }
  return undefined;
}

function assertSupportedPromptfooType(type: string, evalId: string, name?: string): void {
  const baseType = type.startsWith('not-') ? type.slice(4) : type;
  if (!UNSUPPORTED_PROMPTFOO_ASSERTION_TYPES.has(baseType)) {
    return;
  }
  throw new Error(
    `Unsupported promptfoo assertion type '${type}' in '${evalId}'` +
      `${name ? ` for evaluator '${name}'` : ''}. This type is future scope in AgentV and is not accepted as a custom assertion.`,
  );
}

/**
 * Parse evaluators from eval case configuration.
 */
export async function parseGraders(
  rawEvalCase: JsonObject & {
    readonly execution?: JsonValue;
    readonly assert?: JsonValue;
  },
  globalExecution: JsonObject | undefined,
  searchRoots: readonly string[],
  evalId: string,
  defaultPreprocessors?: readonly ContentPreprocessorConfig[],
  defaultRubricPrompt?: JsonValue,
): Promise<readonly GraderConfig[] | undefined> {
  const execution = rawEvalCase.execution;
  const executionObject = isJsonObject(execution) ? execution : undefined;

  // Case-level graders priority: assert > execution assert.
  const caseEvaluators =
    rawEvalCase.assert ?? (executionObject ? executionObject.assert : undefined);

  // Root-level default graders.
  const skipDefaults = executionObject?.skip_defaults === true;
  const rootEvaluators = skipDefaults ? undefined : globalExecution?.assert;

  // Parse case-level evaluators
  const parsedCase = await parseGraderList(
    caseEvaluators,
    searchRoots,
    evalId,
    defaultPreprocessors,
    defaultRubricPrompt,
  );
  // Parse root-level evaluators (appended after case-level)
  const parsedRoot = await parseGraderList(
    rootEvaluators,
    searchRoots,
    evalId,
    defaultPreprocessors,
    defaultRubricPrompt,
  );

  if (!parsedCase && !parsedRoot) {
    return undefined;
  }

  // Case-level evaluators run first, root-level defaults appended
  const evaluators: GraderConfig[] = [...(parsedCase ?? []), ...(parsedRoot ?? [])];

  return evaluators.length > 0 ? evaluators : undefined;
}

interface IncludeContext {
  readonly depth: number;
  readonly chain: readonly string[];
}

function isIncludeEntry(value: unknown): value is { include: string } {
  return (
    isJsonObject(value) && typeof value.include === 'string' && Object.keys(value).length === 1
  );
}

function isTemplateReference(value: string): boolean {
  return !value.startsWith('.') && !value.includes('/') && !value.includes('\\');
}

async function resolveAssertionTemplateReference(
  include: string,
  searchRoots: readonly string[],
): Promise<{
  readonly displayPath: string;
  readonly resolvedPath: string;
  readonly attempted: readonly string[];
}> {
  const templateCandidates = isTemplateReference(include)
    ? [
        path.join('.agentv', 'templates', `${include}.yaml`),
        path.join('.agentv', 'templates', `${include}.yml`),
      ]
    : [include];

  const attempted: string[] = [];
  for (const candidate of templateCandidates) {
    const resolved = await resolveFileReference(candidate, searchRoots);
    attempted.push(...resolved.attempted);
    if (resolved.resolvedPath) {
      return {
        displayPath: resolved.displayPath,
        resolvedPath: resolved.resolvedPath,
        attempted,
      };
    }
  }

  return {
    displayPath: templateCandidates[0] ?? include,
    resolvedPath: '',
    attempted,
  };
}

async function loadAssertionTemplateEntries(
  include: string,
  searchRoots: readonly string[],
  evalId: string,
  includeContext: IncludeContext,
): Promise<readonly unknown[]> {
  const nextDepth = includeContext.depth + 1;
  if (nextDepth > MAX_ASSERTION_INCLUDE_DEPTH) {
    const chain = [...includeContext.chain, include].join(' -> ');
    throw new Error(
      `Assertion template include depth exceeded ${MAX_ASSERTION_INCLUDE_DEPTH} in '${evalId}'. Include chain: ${chain}`,
    );
  }

  const resolved = await resolveAssertionTemplateReference(include, searchRoots);
  if (!resolved.resolvedPath) {
    const attempted =
      resolved.attempted.length > 0
        ? `\n${resolved.attempted.map((attempt) => `  Tried: ${attempt}`).join('\n')}`
        : '';
    throw new Error(
      `Assertion template not found in '${evalId}': ${resolved.displayPath}${attempted}`,
    );
  }

  if (includeContext.chain.includes(resolved.resolvedPath)) {
    const cycle = [...includeContext.chain, resolved.resolvedPath].join(' -> ');
    throw new Error(`Assertion template cycle detected in '${evalId}': ${cycle}`);
  }

  const content = await readFile(resolved.resolvedPath, 'utf8');
  const parsed = interpolateEnv(parseYamlValue(content), process.env) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(
      `Invalid assertion template file in '${evalId}': ${resolved.resolvedPath} (expected a YAML object with an assert array)`,
    );
  }

  const assertions = (parsed as Record<string, unknown>).assert;
  if (!Array.isArray(assertions)) {
    throw new Error(
      `Invalid assertion template file in '${evalId}': ${resolved.resolvedPath} is missing a top-level assert array`,
    );
  }

  const templateDir = path.dirname(resolved.resolvedPath);
  const nestedSearchRoots = [
    templateDir,
    ...searchRoots.filter((root) => path.resolve(root) !== templateDir),
  ];

  return (
    (await expandGraderEntries(assertions, nestedSearchRoots, evalId, {
      depth: nextDepth,
      chain: [...includeContext.chain, resolved.resolvedPath],
    })) ?? []
  );
}

async function expandGraderEntries(
  candidateEvaluators: JsonValue | undefined,
  searchRoots: readonly string[],
  evalId: string,
  includeContext: IncludeContext = { depth: 0, chain: [] },
): Promise<readonly unknown[] | undefined> {
  if (candidateEvaluators === undefined) {
    return undefined;
  }

  if (!Array.isArray(candidateEvaluators)) {
    logWarning(`Skipping evaluators for '${evalId}': expected array`);
    return undefined;
  }

  const expanded: unknown[] = [];
  for (const rawEvaluator of candidateEvaluators) {
    if (isIncludeEntry(rawEvaluator)) {
      const included = await loadAssertionTemplateEntries(
        rawEvaluator.include,
        searchRoots,
        evalId,
        includeContext,
      );
      expanded.push(...included);
      continue;
    }
    expanded.push(rawEvaluator);
  }

  return expanded;
}

export async function collectAssertionTemplateSourceReferences(
  rawEvalCase: JsonObject & {
    readonly execution?: JsonValue;
    readonly assert?: JsonValue;
  },
  globalExecution: JsonObject | undefined,
  searchRoots: readonly string[],
  evalId: string,
): Promise<readonly EvalSourceReference[]> {
  const execution = rawEvalCase.execution;
  const executionObject = isJsonObject(execution) ? execution : undefined;
  const caseEvaluators =
    rawEvalCase.assert ?? (executionObject ? executionObject.assert : undefined);
  const skipDefaults = executionObject?.skip_defaults === true;
  const rootEvaluators = skipDefaults ? undefined : globalExecution?.assert;

  return [
    ...(await collectAssertionTemplateReferencesFromValue(caseEvaluators, searchRoots, evalId)),
    ...(await collectAssertionTemplateReferencesFromValue(rootEvaluators, searchRoots, evalId)),
  ];
}

async function collectAssertionTemplateReferencesFromValue(
  value: JsonValue | undefined,
  searchRoots: readonly string[],
  evalId: string,
  includeContext: IncludeContext = { depth: 0, chain: [] },
): Promise<readonly EvalSourceReference[]> {
  if (value === undefined) {
    return [];
  }

  const references: EvalSourceReference[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isIncludeEntry(item)) {
        const nextDepth = includeContext.depth + 1;
        if (nextDepth > MAX_ASSERTION_INCLUDE_DEPTH) {
          const chain = [...includeContext.chain, item.include].join(' -> ');
          throw new Error(
            `Assertion template include depth exceeded ${MAX_ASSERTION_INCLUDE_DEPTH} in '${evalId}'. Include chain: ${chain}`,
          );
        }
        const resolved = await resolveAssertionTemplateReference(item.include, searchRoots);
        references.push({
          kind: 'assertion_template',
          displayPath: resolved.displayPath,
          ...(resolved.resolvedPath ? { resolvedPath: path.resolve(resolved.resolvedPath) } : {}),
        });

        if (resolved.resolvedPath) {
          if (includeContext.chain.includes(resolved.resolvedPath)) {
            const cycle = [...includeContext.chain, resolved.resolvedPath].join(' -> ');
            throw new Error(`Assertion template cycle detected in '${evalId}': ${cycle}`);
          }

          const content = await readFile(resolved.resolvedPath, 'utf8');
          const parsed = interpolateEnv(parseYamlValue(content), process.env) as unknown;
          if (isJsonObject(parsed) && Array.isArray((parsed as Record<string, unknown>).assert)) {
            const templateDir = path.dirname(resolved.resolvedPath);
            const nestedSearchRoots = [
              templateDir,
              ...searchRoots.filter((root) => path.resolve(root) !== templateDir),
            ];
            references.push(
              ...(await collectAssertionTemplateReferencesFromValue(
                (parsed as Record<string, JsonValue>).assert,
                nestedSearchRoots,
                evalId,
                {
                  depth: nextDepth,
                  chain: [...includeContext.chain, resolved.resolvedPath],
                },
              )),
            );
          }
        }
        continue;
      }

      if (isJsonObject(item)) {
        references.push(
          ...(await collectAssertionTemplateReferencesFromObject(
            item,
            searchRoots,
            evalId,
            includeContext,
          )),
        );
      }
    }
  } else if (isJsonObject(value)) {
    references.push(
      ...(await collectAssertionTemplateReferencesFromObject(
        value,
        searchRoots,
        evalId,
        includeContext,
      )),
    );
  }

  return references;
}

async function collectAssertionTemplateReferencesFromObject(
  value: JsonObject,
  searchRoots: readonly string[],
  evalId: string,
  includeContext: IncludeContext,
): Promise<readonly EvalSourceReference[]> {
  const references: EvalSourceReference[] = [];
  references.push(
    ...(await collectAssertionTemplateReferencesFromValue(
      value.assert,
      searchRoots,
      evalId,
      includeContext,
    )),
  );
  return references;
}

/**
 * Parse a raw evaluator array into typed GraderConfig objects.
 */
async function parseGraderList(
  candidateEvaluators: JsonValue | undefined,
  searchRoots: readonly string[],
  evalId: string,
  defaultPreprocessors?: readonly ContentPreprocessorConfig[],
  defaultRubricPrompt?: JsonValue,
  inheritedAssertionConfig?: JsonObject,
): Promise<readonly GraderConfig[] | undefined> {
  const expandedEvaluators = await expandGraderEntries(candidateEvaluators, searchRoots, evalId);
  if (!expandedEvaluators) {
    return undefined;
  }

  // Pre-process: collect all string entries across the array (regardless of position) and
  // group them into one llm-rubric assertion inserted at the first-string position.
  // Non-string entries are preserved in their original relative order.
  const firstStringIndex = expandedEvaluators.findIndex((e) => typeof e === 'string');
  const processedEvaluators: unknown[] =
    firstStringIndex === -1
      ? [...expandedEvaluators]
      : (() => {
          const PLACEHOLDER = Symbol('rubric-placeholder');
          const strings: string[] = [];
          const result: unknown[] = [];
          let rubricInserted = false;
          for (const item of expandedEvaluators) {
            if (typeof item === 'string') {
              const trimmed = item.trim();
              if (trimmed.length === 0) {
                logWarning(`Skipping empty string criterion in assert array for '${evalId}'`);
              } else {
                strings.push(trimmed);
              }
              if (!rubricInserted) {
                result.push(PLACEHOLDER);
                rubricInserted = true;
              }
            } else {
              result.push(item);
            }
          }
          const placeholderIndex = result.indexOf(PLACEHOLDER);
          if (strings.length > 0 && placeholderIndex !== -1) {
            // Set weight = number of criteria so each user-visible string assertion contributes
            // equal weight to the overall score alongside other explicit graders.
            // e.g. [contains, "crit1", "crit2", "crit3"] → contains(w=1) + llm-rubric(w=3)
            // → each of the 4 visible assertions counts equally.
            result[placeholderIndex] = {
              type: 'llm-rubric',
              value: strings,
              weight: strings.length,
            };
          } else if (placeholderIndex !== -1) {
            // All strings were empty — remove the placeholder
            result.splice(placeholderIndex, 1);
          }
          return result;
        })();

  const evaluators: GraderConfig[] = [];

  for (const rawEvaluatorEntry of processedEvaluators) {
    if (!isJsonObject(rawEvaluatorEntry)) {
      logWarning(`Skipping invalid evaluator entry for '${evalId}' (expected object)`);
      continue;
    }

    const rawEvaluator = withInheritedAssertionConfig(rawEvaluatorEntry, inheritedAssertionConfig);
    const rawName = asString(rawEvaluator.metric);
    const rawType = rawEvaluator.type;
    const normalizedType = typeof rawType === 'string' ? normalizeGraderType(rawType) : rawType;
    const negatedType =
      typeof normalizedType === 'string' && normalizedType.startsWith('not-')
        ? normalizedType.slice(4)
        : undefined;
    const typeValue =
      negatedType && isTrajectoryGraderKind(negatedType) ? negatedType : normalizedType;
    const inverse = negatedType && isTrajectoryGraderKind(negatedType) ? true : undefined;

    if (typeof normalizedType === 'string') {
      const staleMessage = staleAuthoredGraderMessage(rawEvaluator);
      if (staleMessage) {
        throw new Error(
          `Unsupported grader '${rawType}' in '${evalId}'` +
            `${rawName ? ` for evaluator '${rawName}'` : ''}. ${staleMessage}`,
        );
      }
      const replacement = removedGraderReplacement(normalizedType);
      if (replacement) {
        throw new Error(
          `Unsupported grader '${rawType}' in '${evalId}'. Use '${replacement}' instead.`,
        );
      }
      assertSupportedPromptfooType(normalizedType, evalId, rawName);
    }

    // Unknown types are treated as custom assertion types (resolved via registry discovery)
    const isCustomType = typeof typeValue === 'string' && !isGraderKind(typeValue);
    if (typeof typeValue !== 'string') {
      logWarning(`Skipping evaluator with invalid type in '${evalId}'`);
      continue;
    }

    const customTypeName = isCustomType ? typeValue : undefined;

    // Auto-generate name from type if not provided
    const name =
      rawName ??
      (isCustomType ? typeValue : generateAssertionName(typeValue as GraderKind, rawEvaluator));
    if (!name) {
      logWarning(`Skipping evaluator with missing metric in '${evalId}'`);
      continue;
    }

    const negate = rawEvaluator.negate === true ? true : undefined;
    if (rawEvaluator.postprocess !== undefined) {
      throw new Error(
        `Grader '${name}' in '${evalId}': postprocess has been removed. Use transform instead.`,
      );
    }
    if (rawEvaluator.preprocessors !== undefined) {
      throw new Error(
        `Grader '${name}' in '${evalId}': preprocessors has been removed from authored eval YAML. Use transform instead.`,
      );
    }
    const transform = await parseTransformSpec(
      rawEvaluator.transform as JsonValue | undefined,
      searchRoots,
      `Grader '${name}' in '${evalId}'`,
    );
    const pushEvaluator = (config: GraderConfig): void => {
      evaluators.push(transform !== undefined ? { ...config, transform } : config);
    };
    const inheritedInternalPreprocessors = defaultPreprocessors;

    if (isTrajectoryGraderKind(typeValue)) {
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: typeValue,
        ...(rawEvaluator.value !== undefined ? { value: rawEvaluator.value as JsonValue } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(inverse || negate ? { inverse: true } : {}),
      });
      continue;
    }

    // Custom assertion types — store with their type name for registry dispatch
    if (isCustomType) {
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      // Collect all properties except known meta-keys as pass-through config
      const knownProps = new Set([
        'metric',
        'type',
        'weight',
        'required',
        'min_score',
        'negate',
        'transform',
        'postprocess',
      ]);
      const config: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(rawEvaluator)) {
        if (!knownProps.has(key) && value !== undefined) {
          config[key] = value as JsonValue;
        }
      }
      pushEvaluator({
        name,
        type: customTypeName as unknown as GraderKind,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      } as GraderConfig);
      continue;
    }

    if (typeValue === 'assert-set') {
      const rawMembers = rawEvaluator.assert;
      if (!Array.isArray(rawMembers)) {
        logWarning(`Skipping assert-set evaluator '${name}' in '${evalId}': missing assert array`);
        continue;
      }

      const config = isJsonObject(rawEvaluator.config) ? rawEvaluator.config : undefined;
      const parsedMembers = await parseGraderList(
        rawMembers as JsonValue,
        searchRoots,
        `${evalId}:${name}`,
        defaultPreprocessors,
        defaultRubricPrompt,
        config,
      );
      if (!parsedMembers || parsedMembers.length === 0) {
        logWarning(
          `Skipping assert-set evaluator '${name}' in '${evalId}': no valid child assertions`,
        );
        continue;
      }

      const threshold =
        typeof rawEvaluator.threshold === 'number' &&
        rawEvaluator.threshold >= 0 &&
        rawEvaluator.threshold <= 1
          ? rawEvaluator.threshold
          : undefined;
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'assert-set',
        assertions: parsedMembers,
        ...(config !== undefined ? { config } : {}),
        ...(threshold !== undefined ? { threshold } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'script') {
      const displayType = 'script';
      let command: string[] | undefined;
      if (rawEvaluator.script !== undefined) {
        throw new Error(
          `Grader '${name}' in '${evalId}': 'script' field has been removed. Use 'command' instead.`,
        );
      }
      const rawCommand = rawEvaluator.command;

      if (typeof rawCommand === 'string') {
        const trimmed = rawCommand.trim();
        if (trimmed.length === 0) {
          throw new Error(
            `Invalid ${displayType} command for evaluator '${name}' in '${evalId}': command cannot be empty`,
          );
        }
        command = parseCommandToArgv(trimmed);
      } else {
        command = asStringArray(
          rawCommand,
          `${displayType} command for evaluator '${name}' in '${evalId}'`,
        );
      }

      if (!command) {
        logWarning(`Skipping ${displayType} evaluator '${name}' in '${evalId}': missing command`);
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const resolvedScriptPath = await resolveOptionalCommandSource(command, searchRoots);

      const cwd = asString(rawEvaluator.cwd);
      let resolvedCwd: string | undefined;

      if (cwd) {
        const resolved = await resolveFileReference(cwd, searchRoots);
        if (resolved.resolvedPath) {
          resolvedCwd = path.resolve(resolved.resolvedPath);
        } else {
          logWarning(
            `${displayType} evaluator '${name}' in '${evalId}': cwd not found (${resolved.displayPath})`,
            resolved.attempted.length > 0
              ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`)
              : undefined,
          );
        }
      } else {
        resolvedCwd = searchRoots[0];
      }

      // Parse optional target config (enables target proxy access)
      const rawTarget = rawEvaluator.target;
      let targetConfig: import('../types.js').TargetAccessConfig | undefined;
      if (rawTarget !== undefined) {
        if (isJsonObject(rawTarget)) {
          const maxCalls = rawTarget.max_calls;
          if (maxCalls !== undefined && (typeof maxCalls !== 'number' || maxCalls < 0)) {
            logWarning(
              `Invalid target.max_calls for evaluator '${name}' in '${evalId}': must be a non-negative number`,
            );
          } else {
            targetConfig = {
              ...(typeof maxCalls === 'number' ? { max_calls: maxCalls } : {}),
            };
          }
        } else if (rawTarget === true) {
          // Support shorthand: `target: true` to enable with defaults
          targetConfig = {};
        } else {
          logWarning(
            `Invalid target config for evaluator '${name}' in '${evalId}': expected object or true`,
          );
        }
      }

      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      // Collect unrecognized properties as pass-through config
      const knownProps = new Set([
        'metric',
        'type',
        'command',
        'cwd',
        'weight',
        'target',
        'config',
        'preprocessors',
        'required',
        'min_score',
        'negate',
        'transform',
        'postprocess',
      ]);
      const config: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(rawEvaluator)) {
        if (!knownProps.has(key) && value !== undefined) {
          config[key] = value as JsonValue;
        }
      }
      const topLevelConfig = isJsonObject(rawEvaluator.config)
        ? (rawEvaluator.config as Record<string, JsonValue>)
        : {};
      const mergedConfig = { ...config, ...topLevelConfig };

      pushEvaluator({
        name,
        type: 'script',
        command,
        ...(resolvedScriptPath ? { resolvedScriptPath } : {}),
        cwd,
        resolvedCwd,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(Object.keys(mergedConfig).length > 0 ? { config: mergedConfig } : {}),
        ...(inheritedInternalPreprocessors
          ? { preprocessors: inheritedInternalPreprocessors }
          : {}),
        ...(targetConfig !== undefined ? { target: targetConfig } : {}),
      });
      continue;
    }

    if (typeValue === 'tool-trajectory') {
      const mode = asString(rawEvaluator.mode);
      if (
        mode !== 'any_order' &&
        mode !== 'in_order' &&
        mode !== 'exact' &&
        mode !== 'subset' &&
        mode !== 'superset'
      ) {
        logWarning(
          `Skipping tool-trajectory evaluator '${name}' in '${evalId}': invalid mode '${mode}' (must be any_order, in_order, exact, subset, or superset)`,
        );
        continue;
      }

      const rawMinimums = rawEvaluator.minimums;
      let minimums: Record<string, number> | undefined;
      if (rawMinimums !== undefined) {
        if (!isJsonObject(rawMinimums)) {
          logWarning(
            `Skipping tool-trajectory evaluator '${name}' in '${evalId}': minimums must be an object`,
          );
          continue;
        }
        minimums = {};
        for (const [toolName, count] of Object.entries(rawMinimums)) {
          if (typeof count === 'number' && count >= 0) {
            minimums[toolName] = count;
          }
        }
      }

      // Parse args_match at evaluator level (snake_case from YAML -> camelCase)
      const rawArgsMatch = rawEvaluator.args_match ?? rawEvaluator.argsMatch;
      let argsMatch: import('../trace.js').ArgsMatchMode | readonly string[] | undefined;
      if (rawArgsMatch !== undefined) {
        if (Array.isArray(rawArgsMatch)) {
          // Field list mode: string array of field paths
          const fieldList = rawArgsMatch.filter(
            (f): f is string => typeof f === 'string' && f.length > 0,
          );
          if (fieldList.length > 0) {
            argsMatch = fieldList;
          }
        } else if (typeof rawArgsMatch === 'string') {
          if (
            rawArgsMatch === 'exact' ||
            rawArgsMatch === 'superset' ||
            rawArgsMatch === 'subset' ||
            rawArgsMatch === 'ignore'
          ) {
            argsMatch = rawArgsMatch;
          } else {
            logWarning(
              `Invalid args_match '${rawArgsMatch}' for tool-trajectory evaluator '${name}' in '${evalId}': must be exact, superset, subset, ignore, or a string array`,
            );
          }
        }
      }

      const rawExpected = rawEvaluator.expected;
      let expected: ToolTrajectoryExpectedItem[] | undefined;
      if (rawExpected !== undefined) {
        if (!Array.isArray(rawExpected)) {
          logWarning(
            `Skipping tool-trajectory evaluator '${name}' in '${evalId}': expected must be an array`,
          );
          continue;
        }
        expected = [];
        for (const item of rawExpected) {
          if (isJsonObject(item) && typeof item.tool === 'string') {
            // Parse optional args field: 'any' or Record<string, unknown>
            let args: ToolTrajectoryExpectedItem['args'];
            if (item.args === 'any') {
              args = 'any';
            } else if (isJsonObject(item.args)) {
              args = item.args as Record<string, unknown>;
            }

            // Parse optional max_duration_ms (snake_case from YAML -> camelCase)
            const rawMaxDuration = item.max_duration_ms ?? item.maxDurationMs;
            const maxDurationMs =
              typeof rawMaxDuration === 'number' && rawMaxDuration >= 0
                ? rawMaxDuration
                : undefined;

            // Parse per-item args_match (snake_case from YAML -> camelCase)
            const rawItemArgsMatch = item.args_match ?? item.argsMatch;
            let itemArgsMatch: import('../trace.js').ArgsMatchMode | readonly string[] | undefined;
            if (rawItemArgsMatch !== undefined) {
              if (Array.isArray(rawItemArgsMatch)) {
                const fieldList = rawItemArgsMatch.filter(
                  (f): f is string => typeof f === 'string' && f.length > 0,
                );
                if (fieldList.length > 0) {
                  itemArgsMatch = fieldList;
                }
              } else if (typeof rawItemArgsMatch === 'string') {
                if (
                  rawItemArgsMatch === 'exact' ||
                  rawItemArgsMatch === 'superset' ||
                  rawItemArgsMatch === 'subset' ||
                  rawItemArgsMatch === 'ignore'
                ) {
                  itemArgsMatch = rawItemArgsMatch;
                } else {
                  logWarning(
                    `Invalid args_match '${rawItemArgsMatch}' for expected item '${item.tool}' in evaluator '${name}' in '${evalId}'`,
                  );
                }
              }
            }

            expected.push({
              tool: item.tool,
              ...(args !== undefined ? { args } : {}),
              ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
              ...(itemArgsMatch !== undefined ? { argsMatch: itemArgsMatch } : {}),
            });
          }
        }
      }

      // Validate config completeness based on mode
      if (mode === 'any_order' && !minimums) {
        logWarning(
          `Skipping tool-trajectory evaluator '${name}' in '${evalId}': any_order mode requires minimums`,
        );
        continue;
      }

      if (
        (mode === 'in_order' || mode === 'exact' || mode === 'subset' || mode === 'superset') &&
        !expected
      ) {
        logWarning(
          `Skipping tool-trajectory evaluator '${name}' in '${evalId}': ${mode} mode requires expected`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      const config: ToolTrajectoryGraderConfig = {
        name,
        type: 'tool-trajectory',
        mode,
        ...(minimums ? { minimums } : {}),
        ...(expected ? { expected } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(argsMatch !== undefined ? { argsMatch } : {}),
      };

      pushEvaluator(config);
      continue;
    }

    if (typeValue === 'skill-used' || typeValue === 'not-skill-used') {
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: typeValue,
        value: rawEvaluator.value as import('../types.js').SkillUsedGraderConfig['value'],
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'field-accuracy') {
      const rawFields = rawEvaluator.fields;
      if (!Array.isArray(rawFields)) {
        logWarning(
          `Skipping field-accuracy evaluator '${name}' in '${evalId}': missing fields array`,
        );
        continue;
      }

      if (rawFields.length === 0) {
        logWarning(
          `Skipping field-accuracy evaluator '${name}' in '${evalId}': fields array is empty`,
        );
        continue;
      }

      const fields: import('../types.js').FieldConfig[] = [];
      for (const rawField of rawFields) {
        if (!isJsonObject(rawField)) {
          logWarning(
            `Skipping invalid field entry in field-accuracy evaluator '${name}' (expected object)`,
          );
          continue;
        }

        const fieldPath = asString(rawField.path);
        const match = asString(rawField.match);

        if (!fieldPath) {
          logWarning(
            `Skipping field without path in field-accuracy evaluator '${name}' in '${evalId}'`,
          );
          continue;
        }

        if (!match || !isValidFieldMatchType(match)) {
          logWarning(
            `Skipping field '${fieldPath}' with invalid match type '${match}' in evaluator '${name}' (must be exact, numeric_tolerance, or date). For fuzzy matching, use a script evaluator.`,
          );
          continue;
        }

        const fieldConfig: import('../types.js').FieldConfig = {
          path: fieldPath,
          match,
          ...(typeof rawField.required === 'boolean' ? { required: rawField.required } : {}),
          ...(typeof rawField.weight === 'number' ? { weight: rawField.weight } : {}),
          ...(typeof rawField.tolerance === 'number' ? { tolerance: rawField.tolerance } : {}),
          ...(typeof rawField.relative === 'boolean' ? { relative: rawField.relative } : {}),
          ...(Array.isArray(rawField.formats)
            ? { formats: rawField.formats.filter((f): f is string => typeof f === 'string') }
            : {}),
        };

        fields.push(fieldConfig);
      }

      if (fields.length === 0) {
        logWarning(
          `Skipping field-accuracy evaluator '${name}' in '${evalId}': no valid fields found`,
        );
        continue;
      }

      const aggregation = asString(rawEvaluator.aggregation);
      const validAggregation = isValidFieldAggregationType(aggregation) ? aggregation : undefined;

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: 'field-accuracy',
        fields,
        ...(validAggregation ? { aggregation: validAggregation } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'latency') {
      const threshold = rawEvaluator.threshold;
      if (typeof threshold !== 'number' || threshold < 0) {
        logWarning(
          `Skipping latency evaluator '${name}' in '${evalId}': threshold must be a non-negative number`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: 'latency',
        threshold,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'cost') {
      const budget = rawEvaluator.budget;
      if (typeof budget !== 'number' || budget < 0) {
        logWarning(
          `Skipping cost evaluator '${name}' in '${evalId}': budget must be a non-negative number`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: 'cost',
        budget,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'token-usage') {
      const maxTotal = rawEvaluator.max_total ?? rawEvaluator.maxTotal;
      const maxInput = rawEvaluator.max_input ?? rawEvaluator.maxInput;
      const maxOutput = rawEvaluator.max_output ?? rawEvaluator.maxOutput;

      const limits = [
        ['max_total', maxTotal],
        ['max_input', maxInput],
        ['max_output', maxOutput],
      ] as const;

      const validLimits: Partial<Record<'max_total' | 'max_input' | 'max_output', number>> = {};

      for (const [key, raw] of limits) {
        if (raw === undefined) continue;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
          logWarning(
            `Skipping token-usage evaluator '${name}' in '${evalId}': ${key} must be a non-negative finite number`,
          );
          continue;
        }
        validLimits[key] = raw;
      }

      if (
        validLimits.max_total === undefined &&
        validLimits.max_input === undefined &&
        validLimits.max_output === undefined
      ) {
        logWarning(
          `Skipping token-usage evaluator '${name}' in '${evalId}': must set at least one of max_total, max_input, max_output`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: 'token-usage',
        ...validLimits,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'execution-metrics') {
      const maxToolCalls = rawEvaluator.max_tool_calls ?? rawEvaluator.maxToolCalls;
      const maxLlmCalls = rawEvaluator.max_llm_calls ?? rawEvaluator.maxLlmCalls;
      const maxTokens = rawEvaluator.max_tokens ?? rawEvaluator.maxTokens;
      const maxCostUsd = rawEvaluator.max_cost_usd ?? rawEvaluator.maxCostUsd;
      const maxDurationMs = rawEvaluator.max_duration_ms ?? rawEvaluator.maxDurationMs;
      const targetExplorationRatio =
        rawEvaluator.target_exploration_ratio ?? rawEvaluator.targetExplorationRatio;
      const explorationTolerance =
        rawEvaluator.exploration_tolerance ?? rawEvaluator.explorationTolerance;

      const thresholds = [
        ['max_tool_calls', maxToolCalls],
        ['max_llm_calls', maxLlmCalls],
        ['max_tokens', maxTokens],
        ['max_cost_usd', maxCostUsd],
        ['max_duration_ms', maxDurationMs],
        ['target_exploration_ratio', targetExplorationRatio],
        ['exploration_tolerance', explorationTolerance],
      ] as const;

      type ThresholdKey =
        | 'max_tool_calls'
        | 'max_llm_calls'
        | 'max_tokens'
        | 'max_cost_usd'
        | 'max_duration_ms'
        | 'target_exploration_ratio'
        | 'exploration_tolerance';

      const validThresholds: Partial<Record<ThresholdKey, number>> = {};
      let hasError = false;

      for (const [key, raw] of thresholds) {
        if (raw === undefined) continue;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
          logWarning(
            `Skipping execution-metrics evaluator '${name}' in '${evalId}': ${key} must be a non-negative finite number`,
          );
          hasError = true;
          break;
        }
        validThresholds[key] = raw;
      }

      if (hasError) {
        continue;
      }

      // Validate that at least one threshold is specified (excluding exploration_tolerance which is only a modifier)
      const hasThreshold =
        validThresholds.max_tool_calls !== undefined ||
        validThresholds.max_llm_calls !== undefined ||
        validThresholds.max_tokens !== undefined ||
        validThresholds.max_cost_usd !== undefined ||
        validThresholds.max_duration_ms !== undefined ||
        validThresholds.target_exploration_ratio !== undefined;

      if (!hasThreshold) {
        logWarning(
          `Skipping execution-metrics evaluator '${name}' in '${evalId}': must set at least one threshold (max_tool_calls, max_llm_calls, max_tokens, max_cost_usd, max_duration_ms, or target_exploration_ratio)`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      pushEvaluator({
        name,
        type: 'execution-metrics',
        ...validThresholds,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'skill-trigger') {
      const skillName = asString(rawEvaluator.skill);
      if (!skillName) {
        logWarning(`Skipping skill-trigger evaluator '${name}' in '${evalId}': missing skill`);
        continue;
      }
      const rawShouldTrigger = rawEvaluator.should_trigger;
      const shouldTrigger = typeof rawShouldTrigger === 'boolean' ? rawShouldTrigger : undefined;
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'skill-trigger',
        skill: skillName,
        ...(shouldTrigger !== undefined ? { should_trigger: shouldTrigger } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'javascript' || typeValue === 'python' || typeValue === 'webhook') {
      const value = asString(rawEvaluator.value);
      if (!value || value.trim().length === 0) {
        logWarning(`Skipping ${typeValue} evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const threshold =
        typeof rawEvaluator.threshold === 'number' &&
        rawEvaluator.threshold >= 0 &&
        rawEvaluator.threshold <= 1
          ? rawEvaluator.threshold
          : undefined;
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      const config = isJsonObject(rawEvaluator.config) ? rawEvaluator.config : undefined;
      pushEvaluator({
        name,
        type: typeValue,
        value,
        ...(threshold !== undefined ? { threshold } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(config !== undefined ? { config } : {}),
      });
      continue;
    }

    if (typeValue === 'similar') {
      const value = asString(rawEvaluator.value);
      if (!value || value.trim().length === 0) {
        logWarning(`Skipping similar evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const threshold =
        typeof rawEvaluator.threshold === 'number' &&
        rawEvaluator.threshold >= 0 &&
        rawEvaluator.threshold <= 1
          ? rawEvaluator.threshold
          : undefined;
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      const provider =
        typeof rawEvaluator.provider === 'string' || isJsonObject(rawEvaluator.provider)
          ? rawEvaluator.provider
          : undefined;
      const config = isJsonObject(rawEvaluator.config) ? rawEvaluator.config : undefined;
      pushEvaluator({
        name,
        type: 'similar',
        value,
        ...(threshold !== undefined ? { threshold } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(config !== undefined ? { config } : {}),
      });
      continue;
    }

    if (typeValue === 'contains') {
      const value = asString(rawEvaluator.value);
      if (!value) {
        logWarning(`Skipping contains evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'contains',
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'contains-any' || typeValue === 'contains-all') {
      const value = asStringArrayStrict(rawEvaluator.value);
      if (!value || value.length === 0) {
        logWarning(
          `Skipping ${typeValue} evaluator '${name}' in '${evalId}': value must be a non-empty string array`,
        );
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').GraderConfig);
      continue;
    }

    if (typeValue === 'icontains') {
      const value = asString(rawEvaluator.value);
      if (!value) {
        logWarning(`Skipping icontains evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'icontains',
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').GraderConfig);
      continue;
    }

    if (typeValue === 'icontains-any' || typeValue === 'icontains-all') {
      const value = asStringArrayStrict(rawEvaluator.value);
      if (!value || value.length === 0) {
        logWarning(
          `Skipping ${typeValue} evaluator '${name}' in '${evalId}': value must be a non-empty string array`,
        );
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').GraderConfig);
      continue;
    }

    if (typeValue === 'starts-with' || typeValue === 'ends-with') {
      const value = asString(rawEvaluator.value);
      if (!value) {
        logWarning(`Skipping ${typeValue} evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').GraderConfig);
      continue;
    }

    if (typeValue === 'regex') {
      const value = asString(rawEvaluator.value);
      if (!value) {
        logWarning(`Skipping regex evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const flags = asString(rawEvaluator.flags);
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'regex',
        value,
        ...(flags !== undefined ? { flags } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'is-json') {
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'is-json',
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    if (typeValue === 'equals') {
      const value = asString(rawEvaluator.value);
      if (!value) {
        logWarning(`Skipping equals evaluator '${name}' in '${evalId}': missing value`);
        continue;
      }
      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );
      pushEvaluator({
        name,
        type: 'equals',
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
      continue;
    }

    const graderTarget = rawEvaluator.target;
    let graderTargetName: string | undefined;
    if (graderTarget !== undefined) {
      if (typeof graderTarget === 'string' && graderTarget.trim().length > 0) {
        graderTargetName = graderTarget;
      } else {
        logWarning(
          `Skipping target override for llm-grader evaluator '${name}' in '${evalId}': target must be a non-empty string`,
        );
      }
    }

    // Parse prompt field - can be string (text template) or object (executable script)
    const rawPrompt =
      rawEvaluator.prompt ?? (typeValue === 'llm-rubric' ? defaultRubricPrompt : undefined);
    const parsedPrompt = await parsePromptField(rawPrompt, name, evalId, searchRoots);
    const { prompt, promptPath, resolvedPromptPath, resolvedPromptScript, promptScriptConfig } =
      parsedPrompt;

    const _model = asString(rawEvaluator.model);

    const rawRubrics = rawEvaluator.rubrics;
    const parsedRubrics = Array.isArray(rawRubrics)
      ? parseRubricItems(normalizeRubricCriteria(rawRubrics) ?? [], name, evalId)
      : undefined;

    const weight = validateWeight(rawEvaluator.weight, name, evalId);
    const { required, min_score } = parseRequiredAndMinScore(
      rawEvaluator.required,
      (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
      name,
      evalId,
    );

    // Collect unrecognized properties as pass-through config (for text prompt templates)
    // Note: For script prompts, config comes from prompt.config instead
    const knownProps = new Set([
      'metric',
      'type',
      'prompt',
      'model',
      'value',
      'criteria',
      'score_ranges',
      'target',
      'weight',
      'config',
      'required',
      'min_score',
      'negate',
      'max_steps',
      'maxSteps',
      'temperature',
      'preprocessors',
      'transform',
      'postprocess',
    ]);
    const config: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(rawEvaluator)) {
      if (!knownProps.has(key) && value !== undefined) {
        config[key] = value as JsonValue;
      }
    }

    // Merge top-level config with any extra properties (top-level config takes precedence)
    const topLevelConfig = isJsonObject(rawEvaluator.config)
      ? (rawEvaluator.config as Record<string, JsonValue>)
      : {};
    const mergedConfig = { ...config, ...topLevelConfig };

    // Determine final config: prompt.config for script prompts, merged config for text prompts
    const finalConfig =
      promptScriptConfig ?? (Object.keys(mergedConfig).length > 0 ? mergedConfig : undefined);

    // Parse optional max_steps and temperature (used in agent mode)
    const rawMaxStepsLlm = rawEvaluator.max_steps ?? rawEvaluator.maxSteps;
    const llmMaxSteps =
      typeof rawMaxStepsLlm === 'number' &&
      Number.isInteger(rawMaxStepsLlm) &&
      rawMaxStepsLlm >= 1 &&
      rawMaxStepsLlm <= 50
        ? rawMaxStepsLlm
        : undefined;
    const rawTempLlm = rawEvaluator.temperature;
    const llmTemperature =
      typeof rawTempLlm === 'number' && rawTempLlm >= 0 && rawTempLlm <= 2 ? rawTempLlm : undefined;

    if (typeValue === 'llm-rubric') {
      for (const removedField of ['criteria', 'rubric_item', 'rubricItem', 'rubrics'] as const) {
        if (rawEvaluator[removedField] !== undefined) {
          throw new Error(
            `Unsupported llm-rubric field '${removedField}' in '${evalId}' for evaluator '${name}'. Use 'value' instead.`,
          );
        }
      }

      const normalizedCriteria = normalizeStructuredRubricValue(rawEvaluator.value, rawEvaluator);
      const structuredRubrics = normalizedCriteria
        ? parseRubricItems(normalizedCriteria, name, evalId)
        : undefined;
      const value =
        typeof rawEvaluator.value === 'string'
          ? rawEvaluator.value
          : Array.isArray(rawEvaluator.value) && rawEvaluator.value.length === 0
            ? undefined
            : rawEvaluator.value !== undefined &&
                (!structuredRubrics || structuredRubrics.length === 0)
              ? rawEvaluator.value
              : undefined;

      if (!value && (!structuredRubrics || structuredRubrics.length === 0) && !prompt) {
        logWarning(
          `Skipping llm-rubric evaluator '${name}' in '${evalId}': expected value or prompt`,
        );
        continue;
      }

      pushEvaluator({
        name,
        type: 'llm-rubric',
        prompt,
        promptPath,
        ...(resolvedPromptPath ? { resolvedPromptPath } : {}),
        ...(resolvedPromptScript ? { resolvedPromptScript } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(structuredRubrics && structuredRubrics.length > 0
          ? { rubrics: structuredRubrics }
          : {}),
        ...(graderTargetName ? { target: graderTargetName } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(finalConfig ? { config: finalConfig } : {}),
        ...(llmMaxSteps !== undefined ? { max_steps: llmMaxSteps } : {}),
        ...(llmTemperature !== undefined ? { temperature: llmTemperature } : {}),
        ...(inheritedInternalPreprocessors
          ? { preprocessors: inheritedInternalPreprocessors }
          : {}),
      });
      continue;
    }

    pushEvaluator({
      name,
      type: 'llm-grader',
      prompt,
      promptPath,
      ...(resolvedPromptPath ? { resolvedPromptPath } : {}),
      ...(resolvedPromptScript ? { resolvedPromptScript } : {}),
      ...(parsedRubrics && parsedRubrics.length > 0 ? { rubrics: parsedRubrics } : {}),
      ...(graderTargetName ? { target: graderTargetName } : {}),
      ...(weight !== undefined ? { weight } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(min_score !== undefined ? { min_score } : {}),
      ...(negate !== undefined ? { negate } : {}),
      ...(finalConfig ? { config: finalConfig } : {}),
      ...(llmMaxSteps !== undefined ? { max_steps: llmMaxSteps } : {}),
      ...(llmTemperature !== undefined ? { temperature: llmTemperature } : {}),
      ...(inheritedInternalPreprocessors ? { preprocessors: inheritedInternalPreprocessors } : {}),
    });
  }

  return evaluators.length > 0 ? evaluators : undefined;
}

function withInheritedAssertionConfig(
  rawEvaluator: JsonObject,
  inheritedConfig?: JsonObject,
): JsonObject {
  const ownConfig = isJsonObject(rawEvaluator.config) ? rawEvaluator.config : undefined;
  if (!inheritedConfig && !ownConfig) {
    return rawEvaluator;
  }

  const mergedConfig = {
    ...(inheritedConfig ?? {}),
    ...(ownConfig ?? {}),
  };

  return {
    ...rawEvaluator,
    config: mergedConfig,
  };
}

interface ParsedPromptField {
  readonly prompt?: string;
  readonly promptPath?: string;
  readonly resolvedPromptPath?: string;
  readonly resolvedPromptScript?: readonly string[];
  readonly promptScriptConfig?: Record<string, unknown>;
  readonly promptConfig: {
    readonly prompt?: string;
    readonly promptPath?: string;
    readonly resolvedPromptPath?: string;
    readonly resolvedPromptScript?: readonly string[];
  };
}

async function parsePromptField(
  rawPrompt: unknown,
  evaluatorName: string,
  evalId: string,
  searchRoots: readonly string[],
): Promise<ParsedPromptField> {
  let prompt: string | undefined;
  let promptPath: string | undefined;
  let resolvedPromptPath: string | undefined;
  let resolvedPromptScript: readonly string[] | undefined;
  let promptScriptConfig: Record<string, unknown> | undefined;

  if (rawPrompt === undefined || rawPrompt === null) {
    return { promptConfig: {} };
  }

  if (typeof rawPrompt === 'string') {
    if (rawPrompt.startsWith(PROMPT_FILE_PREFIX)) {
      const fileRef = rawPrompt.slice(PROMPT_FILE_PREFIX.length);
      const resolved = await resolveFileReference(fileRef, searchRoots);
      if (!resolved.resolvedPath) {
        throw new Error(
          `Grader '${evaluatorName}' in '${evalId}': prompt file not found: ${resolved.displayPath}`,
        );
      }
      promptPath = resolved.displayPath;
      resolvedPromptPath = path.resolve(resolved.resolvedPath);
      await validateCustomPromptContent(resolvedPromptPath);
    } else {
      prompt = rawPrompt;
    }
  } else if (Array.isArray(rawPrompt)) {
    prompt = JSON.stringify(rawPrompt, null, 2);
  } else if (isJsonObject(rawPrompt)) {
    const rawCommand = rawPrompt.command;
    if (rawCommand !== undefined) {
      const command =
        typeof rawCommand === 'string'
          ? parseCommandToArgv(rawCommand.trim())
          : asStringArray(
              rawCommand,
              `prompt command for evaluator '${evaluatorName}' in '${evalId}'`,
            );
      if (!command || command.length === 0) {
        throw new Error(`Grader '${evaluatorName}' in '${evalId}': prompt.command cannot be empty`);
      }

      const resolvedScriptPath = await resolveOptionalCommandSource(command, searchRoots);
      resolvedPromptScript = resolvedScriptPath
        ? [...command.slice(0, -1), resolvedScriptPath]
        : command;

      const rawConfig = rawPrompt.config;
      promptScriptConfig = isJsonObject(rawConfig)
        ? (rawConfig as Record<string, unknown>)
        : undefined;
    } else {
      prompt = JSON.stringify(rawPrompt, null, 2);
    }
  } else {
    logWarning(
      `Skipping prompt field for evaluator '${evaluatorName}' in '${evalId}': expected string, object, or array`,
    );
  }

  const promptConfig = {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(promptPath !== undefined ? { promptPath } : {}),
    ...(resolvedPromptPath !== undefined ? { resolvedPromptPath } : {}),
    ...(resolvedPromptScript !== undefined ? { resolvedPromptScript } : {}),
  };

  return {
    prompt,
    promptPath,
    resolvedPromptPath,
    resolvedPromptScript,
    promptScriptConfig,
    promptConfig,
  };
}

async function parseMergedPreprocessors(
  rawValue: JsonValue | undefined,
  defaultPreprocessors: readonly ContentPreprocessorConfig[] | undefined,
  searchRoots: readonly string[],
  evaluatorName: string,
  evalId: string,
): Promise<readonly ContentPreprocessorConfig[] | undefined> {
  const parsedDefaults = defaultPreprocessors ?? [];
  const parsedOverrides = await parsePreprocessors(rawValue, searchRoots, evaluatorName, evalId);

  if (parsedDefaults.length === 0 && (!parsedOverrides || parsedOverrides.length === 0)) {
    return undefined;
  }

  const merged = new Map<string, ContentPreprocessorConfig>();
  for (const entry of parsedDefaults) {
    merged.set(normalizePreprocessorType(entry.type), entry);
  }
  for (const entry of parsedOverrides ?? []) {
    merged.set(normalizePreprocessorType(entry.type), entry);
  }

  return [...merged.values()];
}

export async function parsePreprocessors(
  rawValue: JsonValue | undefined,
  searchRoots: readonly string[],
  evaluatorName: string,
  evalId: string,
): Promise<readonly ContentPreprocessorConfig[] | undefined> {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue)) {
    throw new Error(`Grader '${evaluatorName}' in '${evalId}': preprocessors must be an array`);
  }

  const preprocessors: ContentPreprocessorConfig[] = [];
  for (const rawEntry of rawValue) {
    if (!isJsonObject(rawEntry)) {
      throw new Error(
        `Grader '${evaluatorName}' in '${evalId}': each preprocessor must be an object`,
      );
    }

    const type = asString(rawEntry.type)?.trim();
    if (!type) {
      throw new Error(`Grader '${evaluatorName}' in '${evalId}': preprocessor.type is required`);
    }

    const command = asStringArray(
      rawEntry.command,
      `preprocessor command for evaluator '${evaluatorName}' in '${evalId}'`,
    );
    if (!command || command.length === 0) {
      throw new Error(
        `Grader '${evaluatorName}' in '${evalId}': preprocessor '${type}' requires command`,
      );
    }

    const commandPath = command[command.length - 1];
    const resolved = await resolveFileReference(commandPath, searchRoots);
    if (!resolved.resolvedPath) {
      throw new Error(
        `Grader '${evaluatorName}' in '${evalId}': preprocessor command file not found: ${resolved.displayPath}`,
      );
    }

    preprocessors.push({
      type,
      command,
      resolvedCommand: [...command.slice(0, -1), path.resolve(resolved.resolvedPath)],
    });
  }

  return preprocessors;
}

/**
 * Generate a descriptive name for evaluators when no explicit name is given.
 * Returns the type name as a fallback so evaluators are never skipped just
 * because the author omitted `name`.
 */
function generateAssertionName(typeValue: string, rawEvaluator: JsonObject): string {
  const value = asString(rawEvaluator.value);
  const arrayValue = Array.isArray(rawEvaluator.value) ? rawEvaluator.value : undefined;

  switch (typeValue) {
    case 'skill-used':
    case 'not-skill-used': {
      const rawValue = rawEvaluator.value;
      if (typeof rawValue === 'string' && rawValue.trim()) {
        return `${typeValue}-${rawValue.trim()}`;
      }
      if (Array.isArray(rawValue)) {
        return `${typeValue}-${rawValue.length}`;
      }
      return typeValue;
    }
    case 'skill-trigger': {
      const skillValue = asString(rawEvaluator.skill);
      return skillValue ? `skill-trigger-${skillValue}` : 'skill-trigger';
    }
    case 'contains':
      return value ? `contains-${value}` : 'contains';
    case 'contains-any':
      return arrayValue ? `contains-any-${arrayValue.length}` : 'contains-any';
    case 'contains-all':
      return arrayValue ? `contains-all-${arrayValue.length}` : 'contains-all';
    case 'icontains':
      return value ? `icontains-${value}` : 'icontains';
    case 'icontains-any':
      return arrayValue ? `icontains-any-${arrayValue.length}` : 'icontains-any';
    case 'icontains-all':
      return arrayValue ? `icontains-all-${arrayValue.length}` : 'icontains-all';
    case 'starts-with':
      return value ? `starts-with-${value}` : 'starts-with';
    case 'ends-with':
      return value ? `ends-with-${value}` : 'ends-with';
    case 'regex':
      return value ? `regex-${value.length > 30 ? value.slice(0, 30) : value}` : 'regex';
    case 'is-json':
      return 'is-json';
    case 'equals':
      return value ? `equals-${value}` : 'equals';
    default:
      // For all other grader types (llm-grader, script, latency, etc.),
      // use the type name itself as the auto-derived name.
      return typeValue;
  }
}

/**
 * Coerce evaluator value to valid GraderKind.
 */
export function coerceEvaluator(
  candidate: JsonValue | undefined,
  contextId: string,
): GraderKind | undefined {
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const replacement = removedGraderReplacement(candidate);
  if (replacement) {
    throw new Error(
      `Unsupported grader '${candidate}' in ${contextId}. Use '${replacement}' instead.`,
    );
  }
  if (isGraderKind(candidate)) {
    return candidate;
  }
  logWarning(`Unknown grader '${candidate}' in ${contextId}, falling back to default`);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parse a value as a string array (for assertion value fields like contains-any). */
function asStringArrayStrict(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value.filter((v): v is string => typeof v === 'string');
  return result.length > 0 ? result : undefined;
}

function asStringArray(value: unknown, description: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${description} must be an array of strings (argv tokens)`);
  }

  if (value.length === 0) {
    throw new Error(`${description} cannot be empty`);
  }

  const result: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      throw new Error(`${description}[${index}] must be a string`);
    }
    if (entry.trim().length === 0) {
      throw new Error(`${description}[${index}] cannot be empty`);
    }
    result.push(entry);
  }

  return result;
}

async function resolveOptionalCommandSource(
  command: readonly string[],
  searchRoots: readonly string[],
): Promise<string | undefined> {
  const candidate = command.at(-1);
  if (!candidate || !looksLikeFilePath(candidate)) {
    return undefined;
  }
  const resolved = await resolveFileReference(candidate, searchRoots);
  return resolved.resolvedPath ? path.resolve(resolved.resolvedPath) : undefined;
}

function looksLikeFilePath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.startsWith('.') ||
    value.includes('/') ||
    value.includes('\\') ||
    /\.[cm]?[jt]sx?$|\.py$|\.sh$|\.bash$|\.rb$|\.go$|\.rs$/i.test(value)
  );
}

function parseCommandToArgv(command: string): string[] {
  if (process.platform === 'win32') {
    return ['cmd.exe', '/c', command];
  }
  return ['sh', '-lc', command];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parser-time criteria warnings were removed because custom graders and escape
 * hatches can consume criteria in ways that static config inspection cannot
 * reliably detect.
 */
export function warnUnconsumedCriteria(
  _criteria: string | undefined,
  _evaluators: readonly GraderConfig[] | undefined,
  _testId: string,
): void {
  return;
}

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join('\n');
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
}

/**
 * Parse `required` and `min_score` from raw evaluator config.
 *
 * - `required: true` → `{ required: true }`
 * - `min_score: 0.7` → `{ min_score: 0.7 }`
 * - Numeric `required` has been removed; use `required: true` + `min_score`.
 */
function parseRequiredAndMinScore(
  rawRequired: JsonValue | undefined,
  rawMinScore: JsonValue | undefined,
  evaluatorName: string,
  evalId: string,
): { required?: boolean; min_score?: number } {
  const result: { required?: boolean; min_score?: number } = {};

  // Parse min_score (explicit field, takes priority)
  if (typeof rawMinScore === 'number' && rawMinScore > 0 && rawMinScore <= 1) {
    result.min_score = rawMinScore;
  }

  // Parse required
  if (rawRequired === true) {
    result.required = true;
  } else if (typeof rawRequired === 'number') {
    throw new Error(
      `Grader '${evaluatorName}' in '${evalId}': numeric 'required: ${rawRequired}' has been removed. ` +
        `Use 'required: true' + 'min_score: ${rawRequired}' instead.`,
    );
  }

  return result;
}

/**
 * Validate and extract weight from evaluator config.
 * Throws if weight is invalid (negative, NaN, or Infinity).
 * Returns undefined if weight is not specified.
 */
function validateWeight(
  rawWeight: unknown,
  evaluatorName: string,
  evalId: string,
): number | undefined {
  if (rawWeight === undefined) {
    return undefined;
  }

  if (typeof rawWeight !== 'number') {
    throw new Error(
      `Invalid weight for evaluator '${evaluatorName}' in '${evalId}': must be a number`,
    );
  }

  if (!Number.isFinite(rawWeight)) {
    throw new Error(
      `Invalid weight for evaluator '${evaluatorName}' in '${evalId}': must be finite (got ${rawWeight})`,
    );
  }

  if (rawWeight < 0) {
    throw new Error(
      `Invalid weight for evaluator '${evaluatorName}' in '${evalId}': must be non-negative (got ${rawWeight})`,
    );
  }

  return rawWeight;
}

const VALID_FIELD_MATCH_TYPES = new Set(['exact', 'numeric_tolerance', 'date']);

function isValidFieldMatchType(value: unknown): value is import('../types.js').FieldMatchType {
  return typeof value === 'string' && VALID_FIELD_MATCH_TYPES.has(value);
}

const VALID_FIELD_AGGREGATION_TYPES = new Set(['weighted_average', 'all_or_nothing']);

function isValidFieldAggregationType(
  value: unknown,
): value is import('../types.js').FieldAggregationType {
  return typeof value === 'string' && VALID_FIELD_AGGREGATION_TYPES.has(value);
}

const VALID_RUBRIC_OPERATORS: ReadonlySet<string> = new Set(RUBRIC_OPERATOR_VALUES);

function parseRubricOperator(
  value: unknown,
  rubricId: string,
  evaluatorName: string,
  evalId: string,
): RubricOperator | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && VALID_RUBRIC_OPERATORS.has(value)) {
    return value as RubricOperator;
  }

  logWarning(
    `Ignoring invalid operator for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': must be one of ${RUBRIC_OPERATOR_VALUES.join(', ')}`,
  );
  return undefined;
}

function isStructuredRubricObject(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }
  if (typeof value.outcome === 'string' || value.score_ranges !== undefined) {
    return true;
  }
  if (typeof value.criteria === 'string') {
    return (
      value.id !== undefined ||
      value.weight !== undefined ||
      value.required !== undefined ||
      value.min_score !== undefined ||
      value.operator !== undefined
    );
  }
  return false;
}

function normalizeStructuredRubricValue(
  value: unknown,
  fallback?: JsonObject,
): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    const hasStructuredItems = value.some(
      (item) => typeof item === 'string' || isStructuredRubricObject(item),
    );
    return hasStructuredItems ? normalizeRubricCriteria(value, fallback) : undefined;
  }

  if (typeof value === 'string') {
    return fallback?.score_ranges !== undefined
      ? normalizeRubricCriteria(value, fallback)
      : undefined;
  }

  return isStructuredRubricObject(value) ? normalizeRubricCriteria(value, fallback) : undefined;
}

function normalizeRubricCriteria(
  raw: unknown,
  fallback?: JsonObject,
): readonly unknown[] | undefined {
  if (typeof raw === 'string') {
    return [
      {
        id: 'rubric-1',
        outcome: raw,
        weight: typeof fallback?.weight === 'number' ? fallback.weight : 1,
        required: typeof fallback?.required === 'boolean' ? fallback.required : true,
        ...(typeof fallback?.min_score === 'number' ? { min_score: fallback.min_score } : {}),
        ...(fallback?.score_ranges !== undefined ? { score_ranges: fallback.score_ranges } : {}),
        ...(typeof fallback?.operator === 'string' ? { operator: fallback.operator } : {}),
      },
    ];
  }

  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      if (typeof item === 'string') {
        return { id: `rubric-${index + 1}`, outcome: item, weight: 1.0, required: true };
      }
      return item;
    });
  }

  if (isJsonObject(raw)) {
    const nestedCriteria = raw.criteria ?? raw.rubrics ?? raw.rubric_item ?? raw.rubricItem;
    if (nestedCriteria !== undefined) {
      return normalizeRubricCriteria(nestedCriteria, raw);
    }
    return [raw];
  }

  if (fallback?.score_ranges !== undefined) {
    const outcome =
      asString(fallback.criteria) ?? asString(fallback.value) ?? asString(fallback.outcome);
    return [
      {
        id: asString(fallback.id) ?? 'rubric-1',
        ...(outcome ? { outcome } : {}),
        score_ranges: fallback.score_ranges,
        weight: typeof fallback.weight === 'number' ? fallback.weight : 1,
        ...(typeof fallback.min_score === 'number' ? { min_score: fallback.min_score } : {}),
        ...(typeof fallback.operator === 'string' ? { operator: fallback.operator } : {}),
      },
    ];
  }

  return undefined;
}

/**
 * Parse rubric items from raw YAML/JSON data.
 * Supports both checklist rubrics and score-range rubrics.
 */
function parseRubricItems(
  rawRubrics: readonly unknown[],
  evaluatorName: string,
  evalId: string,
): import('../types.js').RubricItem[] | undefined {
  const items: import('../types.js').RubricItem[] = [];

  for (const [index, rawRubric] of rawRubrics.entries()) {
    if (!isJsonObject(rawRubric)) {
      logWarning(
        `Skipping invalid rubric entry at index ${index} in evaluator '${evaluatorName}' (expected object)`,
      );
      continue;
    }

    const id = asString(rawRubric.id) ?? `rubric-${index + 1}`;
    const expectedOutcome = asString(rawRubric.outcome) ?? asString(rawRubric.criteria) ?? '';
    const operator = parseRubricOperator(rawRubric.operator, id, evaluatorName, evalId);
    const weight = typeof rawRubric.weight === 'number' ? rawRubric.weight : 1.0;

    if (rawRubric.required_min_score !== undefined) {
      throw new Error(
        `Rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': 'required_min_score' has been removed. Use 'min_score' (0-1 scale) instead.`,
      );
    }

    // Parse min_score (0-1 scale) and checklist required
    let minScore: number | undefined;
    let required: boolean | undefined;

    if (typeof rawRubric.min_score === 'number') {
      const ms = rawRubric.min_score as number;
      if (ms <= 0 || ms > 1) {
        throw new Error(
          `Invalid min_score for rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': must be in (0, 1] (got ${ms})`,
        );
      }
      minScore = ms;
    }

    if (typeof rawRubric.required === 'boolean') {
      required = rawRubric.required;
    }

    // Parse score_ranges if present
    let scoreRanges: import('../types.js').ScoreRange[] | undefined;
    const rawScoreRanges = rawRubric.score_ranges;

    if (rawScoreRanges !== undefined) {
      const normalized = normalizeScoreRangesShorthand(rawScoreRanges);
      if (!Array.isArray(normalized)) {
        throw new Error(
          `Invalid score_ranges for rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': must be an array or shorthand map`,
        );
      }

      scoreRanges = parseScoreRanges(normalized, id, evaluatorName, evalId);

      // For score-range rubrics, outcome at rubric level is optional
      items.push({
        id,
        weight,
        ...(expectedOutcome.length > 0 ? { outcome: expectedOutcome } : {}),
        ...(operator !== undefined ? { operator } : {}),
        ...(minScore !== undefined ? { min_score: minScore } : {}),
        score_ranges: scoreRanges,
      });
    } else {
      // Checklist rubric: outcome is required
      if (expectedOutcome.length === 0) {
        logWarning(
          `Skipping rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': missing outcome`,
        );
        continue;
      }

      items.push({
        id,
        outcome: expectedOutcome,
        ...(operator !== undefined ? { operator } : {}),
        weight,
        // Default to required: true if not specified (backward compatibility)
        required: required ?? true,
        ...(minScore !== undefined ? { min_score: minScore } : {}),
      });
    }
  }

  return items.length > 0 ? items : undefined;
}

/**
 * Normalize score_ranges shorthand map format to the canonical array format.
 *
 * Shorthand (map keys are lower bounds 0-10, values are descriptions):
 *   { 0: "Bad", 3: "OK", 7: "Good", 10: "Perfect" }
 *
 * Normalizes to:
 *   [ { score_range: [0, 2], outcome: "Bad" },
 *     { score_range: [3, 6], outcome: "OK" },
 *     { score_range: [7, 9], outcome: "Good" },
 *     { score_range: [10, 10], outcome: "Perfect" } ]
 *
 * If input is already an array, returns it unchanged.
 */
function normalizeScoreRangesShorthand(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (!isJsonObject(raw)) return raw;

  // Check if this looks like a shorthand map (all keys are numeric strings)
  const keys = Object.keys(raw);
  if (keys.length === 0) return raw;

  const numericKeys: number[] = [];
  for (const key of keys) {
    const num = Number(key);
    if (!Number.isInteger(num) || num < 0 || num > 10) {
      // Not a shorthand map — could be array-of-objects format parsed as object
      return raw;
    }
    if (typeof raw[key] !== 'string' || (raw[key] as string).length === 0) {
      return raw;
    }
    numericKeys.push(num);
  }

  // Sort keys numerically
  numericKeys.sort((a, b) => a - b);

  // Validate starts at 0
  if (numericKeys[0] !== 0) {
    throw new Error(`score_ranges shorthand map must start at 0 (got ${numericKeys[0]})`);
  }

  // Derive ranges: each key is a lower bound, upper bound is (next key - 1) or 10 for the last
  const result: Array<{ score_range: readonly [number, number]; outcome: string }> = [];
  for (let i = 0; i < numericKeys.length; i++) {
    const min = numericKeys[i];
    const max = i < numericKeys.length - 1 ? numericKeys[i + 1] - 1 : 10;
    result.push({
      score_range: [min, max],
      outcome: raw[String(min)] as string,
    });
  }

  return result;
}

/**
 * Parse and validate score ranges for a rubric criterion.
 * Validates:
 * - Ranges are [min, max] with integers 0-10
 * - min <= max
 * - Non-overlapping ranges
 * - Full coverage of 0-10 (warning if not covered)
 * - Each range has non-empty outcome
 */
function parseScoreRanges(
  rawRanges: readonly unknown[],
  rubricId: string,
  evaluatorName: string,
  evalId: string,
): import('../types.js').ScoreRange[] {
  const ranges: import('../types.js').ScoreRange[] = [];

  for (const [index, rawRange] of rawRanges.entries()) {
    if (!isJsonObject(rawRange)) {
      throw new Error(
        `Invalid score_range entry at index ${index} for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': expected object`,
      );
    }

    const scoreRangeValue = rawRange.score_range;
    if (
      !Array.isArray(scoreRangeValue) ||
      scoreRangeValue.length !== 2 ||
      typeof scoreRangeValue[0] !== 'number' ||
      typeof scoreRangeValue[1] !== 'number'
    ) {
      throw new Error(
        `Invalid score_range at index ${index} for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': must be [min, max] array of two numbers`,
      );
    }

    const [min, max] = scoreRangeValue;

    // Validate integers in 0-10 range
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(
        `Invalid score_range at index ${index} for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': values must be integers (got [${min}, ${max}])`,
      );
    }

    if (min < 0 || min > 10 || max < 0 || max > 10) {
      throw new Error(
        `Invalid score_range at index ${index} for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': values must be 0-10 (got [${min}, ${max}])`,
      );
    }

    if (min > max) {
      throw new Error(
        `Invalid score_range at index ${index} for rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': min must be <= max (got [${min}, ${max}])`,
      );
    }

    // Validate outcome
    const expectedOutcome = asString(rawRange.outcome) ?? '';
    if (expectedOutcome.length === 0) {
      throw new Error(
        `Missing outcome for score_range [${min}, ${max}] in rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}'`,
      );
    }

    ranges.push({
      score_range: [min, max] as const,
      outcome: expectedOutcome,
    });
  }

  // Validate non-overlapping ranges
  const sortedRanges = [...ranges].sort((a, b) => a.score_range[0] - b.score_range[0]);
  for (let i = 1; i < sortedRanges.length; i++) {
    const prev = sortedRanges[i - 1];
    const curr = sortedRanges[i];
    if (curr.score_range[0] <= prev.score_range[1]) {
      throw new Error(
        `Overlapping score_ranges in rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': ` +
          `[${prev.score_range[0]}, ${prev.score_range[1]}] overlaps with [${curr.score_range[0]}, ${curr.score_range[1]}]`,
      );
    }
  }

  // Validate full coverage of 0-10 (strict requirement per spec)
  const covered = new Set<number>();
  for (const range of ranges) {
    for (let i = range.score_range[0]; i <= range.score_range[1]; i++) {
      covered.add(i);
    }
  }

  const missing: number[] = [];
  for (let i = 0; i <= 10; i++) {
    if (!covered.has(i)) {
      missing.push(i);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Incomplete score_ranges coverage in rubric '${rubricId}' in evaluator '${evaluatorName}' in '${evalId}': ` +
        `missing coverage for scores: ${missing.join(', ')}. Ranges must cover all integers 0-10.`,
    );
  }

  return ranges;
}
