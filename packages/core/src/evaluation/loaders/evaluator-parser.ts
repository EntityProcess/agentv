import path from 'node:path';

import type { ToolTrajectoryEvaluatorConfig, ToolTrajectoryExpectedItem } from '../trace.js';
import type {
  ContentPreprocessorConfig,
  EvaluatorConfig,
  EvaluatorKind,
  JsonObject,
  JsonValue,
} from '../types.js';
import { isEvaluatorKind } from '../types.js';
import { validateCustomPromptContent } from '../validation/prompt-validator.js';
import { resolveFileReference } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

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

/**
 * Normalize evaluator type names from legacy snake_case to internal kebab-case.
 * Accepts both forms for backward compatibility:
 *   - snake_case: 'llm_grader' -> 'llm-grader' (legacy, still accepted)
 *   - kebab-case: 'llm-grader' -> 'llm-grader' (preferred, passes through)
 *   - single-word: 'contains' -> 'contains' (unchanged)
 */
export function normalizeEvaluatorType(type: string): string {
  return type.replace(/_/g, '-');
}

function isDeprecatedJudgeType(type: string): boolean {
  return type === 'code-judge' || type === 'llm-judge';
}

/**
 * Parse evaluators from eval case configuration.
 */
export async function parseEvaluators(
  rawEvalCase: JsonObject & {
    readonly execution?: JsonValue;
    readonly assertions?: JsonValue;
    readonly evaluators?: JsonValue;
    readonly assert?: JsonValue;
  },
  globalExecution: JsonObject | undefined,
  searchRoots: readonly string[],
  evalId: string,
  defaultPreprocessors?: readonly ContentPreprocessorConfig[],
): Promise<readonly EvaluatorConfig[] | undefined> {
  const execution = rawEvalCase.execution;
  const executionObject = isJsonObject(execution) ? execution : undefined;

  // Case-level graders priority: assertions > assert > legacy execution/top-level assertion lists
  const caseEvaluators =
    rawEvalCase.assertions ??
    rawEvalCase.assert ??
    (executionObject ? executionObject.evaluators : undefined) ?? // deprecated: use assertions
    rawEvalCase.evaluators; // deprecated: use assertions

  // Root-level default graders: assertions > assert > legacy execution assertion list
  const skipDefaults = executionObject?.skip_defaults === true;
  const rootEvaluators = skipDefaults
    ? undefined
    : (globalExecution?.assertions ?? globalExecution?.assert ?? globalExecution?.evaluators); // deprecated: use assertions

  // Parse case-level evaluators
  const parsedCase = await parseEvaluatorList(
    caseEvaluators,
    searchRoots,
    evalId,
    defaultPreprocessors,
  );
  // Parse root-level evaluators (appended after case-level)
  const parsedRoot = await parseEvaluatorList(
    rootEvaluators,
    searchRoots,
    evalId,
    defaultPreprocessors,
  );

  if (!parsedCase && !parsedRoot) {
    return undefined;
  }

  // Case-level evaluators run first, root-level defaults appended
  const evaluators: EvaluatorConfig[] = [...(parsedCase ?? []), ...(parsedRoot ?? [])];

  return evaluators.length > 0 ? evaluators : undefined;
}

/**
 * Parse a raw evaluator array into typed EvaluatorConfig objects.
 */
async function parseEvaluatorList(
  candidateEvaluators: JsonValue | undefined,
  searchRoots: readonly string[],
  evalId: string,
  defaultPreprocessors?: readonly ContentPreprocessorConfig[],
): Promise<readonly EvaluatorConfig[] | undefined> {
  if (candidateEvaluators === undefined) {
    return undefined;
  }

  if (!Array.isArray(candidateEvaluators)) {
    logWarning(`Skipping evaluators for '${evalId}': expected array`);
    return undefined;
  }

  // Pre-process: collect all string entries across the array (regardless of position) and
  // group them into a single rubrics evaluator inserted at the first-string position.
  // Non-string entries are preserved in their original relative order.
  const firstStringIndex = candidateEvaluators.findIndex((e) => typeof e === 'string');
  const processedEvaluators: unknown[] =
    firstStringIndex === -1
      ? [...candidateEvaluators]
      : (() => {
          const PLACEHOLDER = Symbol('rubric-placeholder');
          const strings: string[] = [];
          const result: unknown[] = [];
          let rubricInserted = false;
          for (const item of candidateEvaluators) {
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
            result[placeholderIndex] = { type: 'rubrics', criteria: strings };
          } else if (placeholderIndex !== -1) {
            // All strings were empty — remove the placeholder
            result.splice(placeholderIndex, 1);
          }
          return result;
        })();

  const evaluators: EvaluatorConfig[] = [];

  for (const rawEvaluator of processedEvaluators) {
    if (!isJsonObject(rawEvaluator)) {
      logWarning(`Skipping invalid evaluator entry for '${evalId}' (expected object)`);
      continue;
    }

    const rawName = asString(rawEvaluator.name);
    const rawType = rawEvaluator.type;
    // Normalize legacy snake_case YAML type names to internal kebab-case (e.g., 'llm_grader' -> 'llm-grader')
    const typeValue = typeof rawType === 'string' ? normalizeEvaluatorType(rawType) : rawType;

    if (typeof typeValue === 'string' && isDeprecatedJudgeType(typeValue)) {
      logWarning(
        `Skipping evaluator '${rawName ?? '<unnamed>'}' in '${evalId}': '${rawType}' is deprecated. Use '${typeValue.replace('-judge', '-grader')}' instead`,
      );
      continue;
    }

    // Unknown types are treated as custom assertion types (resolved via registry discovery)
    const isCustomType = typeof typeValue === 'string' && !isEvaluatorKind(typeValue);
    if (typeof typeValue !== 'string') {
      logWarning(`Skipping evaluator with invalid type in '${evalId}'`);
      continue;
    }

    const customTypeName = isCustomType ? typeValue : undefined;

    // Auto-generate name for assertion types if not provided
    const name =
      rawName ??
      (isCustomType ? typeValue : generateAssertionName(typeValue as EvaluatorKind, rawEvaluator));

    if (!name) {
      logWarning(`Skipping evaluator with missing name in '${evalId}'`);
      continue;
    }

    const negate = rawEvaluator.negate === true ? true : undefined;
    const mergedPreprocessors = await parseMergedPreprocessors(
      rawEvaluator.preprocessors as JsonValue | undefined,
      defaultPreprocessors,
      searchRoots,
      name,
      evalId,
    );

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
      const knownProps = new Set(['name', 'type', 'weight', 'required', 'min_score', 'negate']);
      const config: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(rawEvaluator)) {
        if (!knownProps.has(key) && value !== undefined) {
          config[key] = value as JsonValue;
        }
      }
      evaluators.push({
        name,
        type: customTypeName as unknown as EvaluatorKind,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      } as EvaluatorConfig);
      continue;
    }

    if (typeValue === 'code-grader') {
      let command: string[] | undefined;
      // Precedence: command > script (deprecated alias)
      if (rawEvaluator.script !== undefined && rawEvaluator.command === undefined) {
        console.warn(
          `${ANSI_YELLOW}Warning: 'script' is deprecated in evaluator '${name}' in '${evalId}'. Use 'command' instead.${ANSI_RESET}`,
        );
      }
      const rawCommand = rawEvaluator.command ?? rawEvaluator.script;

      if (typeof rawCommand === 'string') {
        const trimmed = rawCommand.trim();
        if (trimmed.length === 0) {
          throw new Error(
            `Invalid code-grader command for evaluator '${name}' in '${evalId}': command cannot be empty`,
          );
        }
        command = parseCommandToArgv(trimmed);
      } else {
        command = asStringArray(
          rawCommand,
          `code-grader command for evaluator '${name}' in '${evalId}'`,
        );
      }

      if (!command) {
        logWarning(`Skipping code-grader evaluator '${name}' in '${evalId}': missing command`);
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      const cwd = asString(rawEvaluator.cwd);
      let resolvedCwd: string | undefined;

      if (cwd) {
        const resolved = await resolveFileReference(cwd, searchRoots);
        if (resolved.resolvedPath) {
          resolvedCwd = path.resolve(resolved.resolvedPath);
        } else {
          logWarning(
            `Code-grader evaluator '${name}' in '${evalId}': cwd not found (${resolved.displayPath})`,
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
        'name',
        'type',
        'command',
        'script',
        'cwd',
        'weight',
        'target',
        'preprocessors',
        'required',
        'negate',
      ]);
      const config: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(rawEvaluator)) {
        if (!knownProps.has(key) && value !== undefined) {
          config[key] = value as JsonValue;
        }
      }

      evaluators.push({
        name,
        type: 'code-grader',
        command,
        cwd,
        resolvedCwd,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ...(mergedPreprocessors ? { preprocessors: mergedPreprocessors } : {}),
        ...(targetConfig !== undefined ? { target: targetConfig } : {}),
      });
      continue;
    }

    if (typeValue === 'composite') {
      // Accept assertions > assert > evaluators (deprecated)
      const rawMembers = rawEvaluator.assertions ?? rawEvaluator.assert ?? rawEvaluator.evaluators; // evaluators deprecated
      if (!Array.isArray(rawMembers)) {
        logWarning(
          `Skipping composite evaluator '${name}' in '${evalId}': missing assertions (or evaluators) array`,
        );
        continue;
      }

      const rawAggregator = rawEvaluator.aggregator;
      if (!isJsonObject(rawAggregator)) {
        logWarning(`Skipping composite evaluator '${name}' in '${evalId}': missing aggregator`);
        continue;
      }

      const aggregatorType = asString(rawAggregator.type);
      const normalizedAggregatorType =
        typeof aggregatorType === 'string'
          ? aggregatorType === 'weighted_average' || aggregatorType === 'threshold'
            ? aggregatorType
            : normalizeEvaluatorType(aggregatorType)
          : aggregatorType;
      if (
        typeof normalizedAggregatorType === 'string' &&
        isDeprecatedJudgeType(normalizedAggregatorType)
      ) {
        logWarning(
          `Skipping composite evaluator '${name}' in '${evalId}': aggregator type '${aggregatorType}' is deprecated. Use '${normalizedAggregatorType.replace('-judge', '-grader')}' instead`,
        );
        continue;
      }
      if (
        normalizedAggregatorType !== 'weighted_average' &&
        normalizedAggregatorType !== 'code-grader' &&
        normalizedAggregatorType !== 'llm-grader' &&
        normalizedAggregatorType !== 'threshold'
      ) {
        logWarning(
          `Skipping composite evaluator '${name}' in '${evalId}': invalid aggregator type '${aggregatorType}'`,
        );
        continue;
      }

      // Recursively parse member evaluators
      const memberEvaluators: EvaluatorConfig[] = [];
      for (const rawMember of rawMembers) {
        if (!isJsonObject(rawMember)) {
          logWarning(`Skipping invalid member evaluator in composite '${name}' (expected object)`);
          continue;
        }

        const memberName = asString(rawMember.name);
        const memberType = rawMember.type;

        if (!memberName || !isEvaluatorKind(memberType)) {
          logWarning(`Skipping member evaluator with invalid name/type in composite '${name}'`);
          continue;
        }

        // Parse member evaluator (reuse existing logic for code, llm-grader, code-grader)
        const memberConfigs = await parseEvaluators(
          { evaluators: [rawMember] },
          undefined,
          searchRoots,
          `${evalId}:${name}:${memberName}`,
        );

        if (memberConfigs && memberConfigs.length > 0) {
          memberEvaluators.push(memberConfigs[0]);
        }
      }

      if (memberEvaluators.length === 0) {
        logWarning(
          `Skipping composite evaluator '${name}' in '${evalId}': no valid member evaluators`,
        );
        continue;
      }

      // Parse aggregator config
      let aggregator: import('../types.js').CompositeAggregatorConfig;

      if (normalizedAggregatorType === 'weighted_average') {
        const weights = isJsonObject(rawAggregator.weights)
          ? (rawAggregator.weights as Record<string, unknown>)
          : undefined;
        const parsedWeights: Record<string, number> = {};
        if (weights) {
          for (const [key, value] of Object.entries(weights)) {
            if (typeof value === 'number') {
              parsedWeights[key] = value;
            }
          }
        }
        aggregator = {
          type: 'weighted_average',
          ...(Object.keys(parsedWeights).length > 0 ? { weights: parsedWeights } : {}),
        };
      } else if (normalizedAggregatorType === 'code-grader') {
        const aggregatorPath = asString(rawAggregator.path);
        if (!aggregatorPath) {
          logWarning(
            `Skipping composite evaluator '${name}' in '${evalId}': code-grader aggregator missing path`,
          );
          continue;
        }

        // Set cwd to eval file directory (first search root)
        // Paths are resolved relative to this directory
        aggregator = {
          type: 'code-grader',
          path: aggregatorPath,
          cwd: searchRoots[0],
        };
      } else if (normalizedAggregatorType === 'threshold') {
        const thresholdValue = rawAggregator.threshold;
        if (typeof thresholdValue !== 'number' || thresholdValue < 0 || thresholdValue > 1) {
          logWarning(
            `Skipping composite evaluator '${name}' in '${evalId}': threshold must be a number between 0.0 and 1.0`,
          );
          continue;
        }
        aggregator = {
          type: 'threshold',
          threshold: thresholdValue,
        };
      } else {
        // llm-grader aggregator — same file:// prefix logic as evaluator prompts
        const rawAggPrompt = asString(rawAggregator.prompt);
        let aggregatorPrompt: string | undefined;
        let promptPath: string | undefined;

        if (rawAggPrompt) {
          if (rawAggPrompt.startsWith(PROMPT_FILE_PREFIX)) {
            // Explicit file reference — error if not found
            const fileRef = rawAggPrompt.slice(PROMPT_FILE_PREFIX.length);
            aggregatorPrompt = fileRef;
            const resolved = await resolveFileReference(fileRef, searchRoots);
            if (resolved.resolvedPath) {
              promptPath = path.resolve(resolved.resolvedPath);
            } else {
              throw new Error(
                `Composite aggregator in '${evalId}': prompt file not found: ${resolved.displayPath}`,
              );
            }
          } else {
            // Bare string — always treat as inline text, no file resolution
            aggregatorPrompt = rawAggPrompt;
          }
        }

        aggregator = {
          type: 'llm-grader',
          ...(aggregatorPrompt ? { prompt: aggregatorPrompt } : {}),
          ...(promptPath ? { promptPath } : {}),
        };
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      evaluators.push({
        name,
        type: 'composite',
        assertions: memberEvaluators,
        aggregator,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
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

      const config: ToolTrajectoryEvaluatorConfig = {
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

      evaluators.push(config);
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
            `Skipping field '${fieldPath}' with invalid match type '${match}' in evaluator '${name}' (must be exact, numeric_tolerance, or date). For fuzzy matching, use a code-grader evaluator.`,
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

      evaluators.push({
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

      evaluators.push({
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

      evaluators.push({
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

      evaluators.push({
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

      evaluators.push({
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
      evaluators.push({
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
      evaluators.push({
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
      evaluators.push({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').EvaluatorConfig);
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
      evaluators.push({
        name,
        type: 'icontains',
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').EvaluatorConfig);
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
      evaluators.push({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').EvaluatorConfig);
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
      evaluators.push({
        name,
        type: typeValue,
        value,
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
      } as import('../types.js').EvaluatorConfig);
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
      evaluators.push({
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
      evaluators.push({
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
      evaluators.push({
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

    if (typeValue === 'rubrics') {
      const rawCriteria = rawEvaluator.criteria;
      if (!Array.isArray(rawCriteria) || rawCriteria.length === 0) {
        logWarning(
          `Skipping rubrics evaluator '${name}' in '${evalId}': criteria must be a non-empty array`,
        );
        continue;
      }

      // Normalize string shorthands to objects before passing to parseRubricItems
      const normalizedCriteria = rawCriteria.map((item, index) => {
        if (typeof item === 'string') {
          return { id: `rubric-${index + 1}`, outcome: item, weight: 1.0, required: true };
        }
        return item;
      });

      const parsedCriteria = parseRubricItems(normalizedCriteria, name, evalId);
      if (!parsedCriteria || parsedCriteria.length === 0) {
        logWarning(`Skipping rubrics evaluator '${name}' in '${evalId}': no valid criteria found`);
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      evaluators.push({
        name,
        type: 'llm-grader',
        rubrics: parsedCriteria,
        ...(graderTargetName ? { target: graderTargetName } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(mergedPreprocessors ? { preprocessors: mergedPreprocessors } : {}),
      });
      continue;
    }

    // Parse prompt field - can be string (text template) or object (executable script)
    const rawPrompt = rawEvaluator.prompt;
    let prompt: string | undefined;
    let promptPath: string | undefined;
    let resolvedPromptScript: string[] | undefined;
    let promptScriptConfig: Record<string, unknown> | undefined;

    if (isJsonObject(rawPrompt)) {
      // Executable prompt template: { command: [...], config: {...} }
      // Precedence: command > script (deprecated alias)
      if (rawPrompt.script !== undefined && rawPrompt.command === undefined) {
        console.warn(
          `${ANSI_YELLOW}Warning: 'prompt.script' is deprecated in evaluator '${name}' in '${evalId}'. Use 'prompt.command' instead.${ANSI_RESET}`,
        );
      }
      const commandArray = asStringArray(
        rawPrompt.command ?? rawPrompt.script,
        `prompt.command for evaluator '${name}' in '${evalId}'`,
      );

      if (!commandArray) {
        throw new Error(`Evaluator '${name}' in '${evalId}': prompt object requires command array`);
      }

      // Resolve the command path (last element is typically the file path)
      const commandPath = commandArray[commandArray.length - 1];
      const resolved = await resolveFileReference(commandPath, searchRoots);

      if (resolved.resolvedPath) {
        // Replace the last element with the resolved path
        resolvedPromptScript = [...commandArray.slice(0, -1), path.resolve(resolved.resolvedPath)];
      } else {
        throw new Error(
          `Evaluator '${name}' in '${evalId}': prompt command file not found: ${resolved.displayPath}`,
        );
      }

      // Extract config from prompt object
      if (isJsonObject(rawPrompt.config)) {
        promptScriptConfig = rawPrompt.config as Record<string, unknown>;
      }
    } else if (typeof rawPrompt === 'string') {
      // Text template prompt — supports explicit file:// prefix for file references.
      //   "file://prompts/grader.md" → explicit file reference, error if not found
      //   "grader.md"                → inline text (no file resolution)
      //   "Evaluate the response"    → inline text

      if (rawPrompt.startsWith(PROMPT_FILE_PREFIX)) {
        // Explicit file reference — strip prefix and resolve. Error if not found.
        const fileRef = rawPrompt.slice(PROMPT_FILE_PREFIX.length);
        prompt = fileRef;
        const resolved = await resolveFileReference(fileRef, searchRoots);
        if (resolved.resolvedPath) {
          promptPath = path.resolve(resolved.resolvedPath);
          try {
            await validateCustomPromptContent(promptPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Evaluator '${name}' template (${promptPath}): ${message}`);
          }
        } else {
          throw new Error(
            `Evaluator '${name}' in '${evalId}': prompt file not found: ${resolved.displayPath}`,
          );
        }
      } else {
        // Bare string — always treat as inline text, no file resolution
        prompt = rawPrompt;
      }
    }

    const _model = asString(rawEvaluator.model);

    const rawRubrics = rawEvaluator.rubrics;
    const parsedRubrics = Array.isArray(rawRubrics)
      ? parseRubricItems(rawRubrics, name, evalId)
      : undefined;

    if (typeValue === 'rubric') {
      if (!parsedRubrics) {
        logWarning(`Skipping rubric evaluator '${name}' in '${evalId}': missing rubrics array`);
        continue;
      }
      if (parsedRubrics.length === 0) {
        logWarning(`Skipping rubric evaluator '${name}' in '${evalId}': no valid rubrics found`);
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);
      const { required, min_score } = parseRequiredAndMinScore(
        rawEvaluator.required,
        (rawEvaluator as Record<string, unknown>).min_score as JsonValue | undefined,
        name,
        evalId,
      );

      // deprecated: `type: rubric` maps to `type: llm-grader` with `rubrics`. Use `type: rubrics` with `criteria` instead.
      evaluators.push({
        name,
        type: 'llm-grader',
        rubrics: parsedRubrics,
        ...(graderTargetName ? { target: graderTargetName } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(min_score !== undefined ? { min_score } : {}),
        ...(negate !== undefined ? { negate } : {}),
        ...(mergedPreprocessors ? { preprocessors: mergedPreprocessors } : {}),
      });
      continue;
    }

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
      'name',
      'type',
      'prompt',
      'model',
      'rubrics',
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

    evaluators.push({
      name,
      type: 'llm-grader',
      prompt,
      promptPath,
      ...(promptPath ? { resolvedPromptPath: promptPath } : {}),
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
      ...(mergedPreprocessors ? { preprocessors: mergedPreprocessors } : {}),
    });
  }

  return evaluators.length > 0 ? evaluators : undefined;
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
    merged.set(entry.type.toLowerCase(), entry);
  }
  for (const entry of parsedOverrides ?? []) {
    merged.set(entry.type.toLowerCase(), entry);
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
    throw new Error(`Evaluator '${evaluatorName}' in '${evalId}': preprocessors must be an array`);
  }

  const preprocessors: ContentPreprocessorConfig[] = [];
  for (const rawEntry of rawValue) {
    if (!isJsonObject(rawEntry)) {
      throw new Error(
        `Evaluator '${evaluatorName}' in '${evalId}': each preprocessor must be an object`,
      );
    }

    const type = asString(rawEntry.type)?.trim();
    if (!type) {
      throw new Error(`Evaluator '${evaluatorName}' in '${evalId}': preprocessor.type is required`);
    }

    const command = asStringArray(
      rawEntry.command,
      `preprocessor command for evaluator '${evaluatorName}' in '${evalId}'`,
    );
    if (!command || command.length === 0) {
      throw new Error(
        `Evaluator '${evaluatorName}' in '${evalId}': preprocessor '${type}' requires command`,
      );
    }

    const commandPath = command[command.length - 1];
    const resolved = await resolveFileReference(commandPath, searchRoots);
    if (!resolved.resolvedPath) {
      throw new Error(
        `Evaluator '${evaluatorName}' in '${evalId}': preprocessor command file not found: ${resolved.displayPath}`,
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

/** Assertion evaluator types that support auto-generated names. */
const ASSERTION_TYPES = new Set([
  'skill-trigger',
  'contains',
  'contains-any',
  'contains-all',
  'icontains',
  'icontains-any',
  'icontains-all',
  'starts-with',
  'ends-with',
  'regex',
  'is-json',
  'equals',
  'rubrics',
]);

/**
 * Generate a descriptive name for assertion-type evaluators when no explicit name is given.
 * Returns undefined for non-assertion types (those still require an explicit name).
 */
function generateAssertionName(typeValue: string, rawEvaluator: JsonObject): string | undefined {
  if (!ASSERTION_TYPES.has(typeValue)) {
    return undefined;
  }

  const value = asString(rawEvaluator.value);
  const arrayValue = Array.isArray(rawEvaluator.value) ? rawEvaluator.value : undefined;

  switch (typeValue) {
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
    case 'rubrics':
      return 'rubrics';
    default:
      return undefined;
  }
}

/**
 * Coerce evaluator value to valid EvaluatorKind.
 */
export function coerceEvaluator(
  candidate: JsonValue | undefined,
  contextId: string,
): EvaluatorKind | undefined {
  if (typeof candidate !== 'string') {
    return undefined;
  }
  // Normalize legacy snake_case to kebab-case
  const normalized = normalizeEvaluatorType(candidate);
  if (isDeprecatedJudgeType(normalized)) {
    throw new Error(
      `Unsupported grader '${candidate}' in ${contextId}. Use '${normalized.replace('-judge', '-grader')}' instead.`,
    );
  }
  if (isEvaluatorKind(normalized)) {
    return normalized;
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
  _evaluators: readonly EvaluatorConfig[] | undefined,
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
 * Parse a `required` value from raw evaluator config.
 * Accepts `true` (uses default 0.8 threshold) or a number in (0, 1] range.
 * Returns undefined for falsy/invalid values.
 */
function parseRequired(value: JsonValue | undefined): boolean | number | undefined {
  if (value === true) return true;
  if (typeof value === 'number' && value > 0 && value <= 1) return value;
  return undefined;
}

/**
 * Parse `required` and `min_score` from raw evaluator config, handling deprecated `required: number`.
 *
 * - `required: true` → `{ required: true }`
 * - `required: 0.7` (deprecated) → `{ required: true, min_score: 0.7 }` + deprecation warning
 * - `min_score: 0.7` → `{ min_score: 0.7 }`
 * - Explicit `min_score` takes priority over `required: number`
 */
function parseRequiredAndMinScore(
  rawRequired: JsonValue | undefined,
  rawMinScore: JsonValue | undefined,
  evaluatorName: string,
  evalId: string,
): { required?: boolean | number; min_score?: number } {
  const result: { required?: boolean | number; min_score?: number } = {};

  // Parse min_score (explicit field, takes priority)
  if (typeof rawMinScore === 'number' && rawMinScore > 0 && rawMinScore <= 1) {
    result.min_score = rawMinScore;
  }

  // Parse required
  if (rawRequired === true) {
    result.required = true;
  } else if (typeof rawRequired === 'number' && rawRequired > 0 && rawRequired <= 1) {
    // Deprecated: required: number → required: true + min_score
    if (result.min_score === undefined) {
      result.min_score = rawRequired;
    }
    // Keep numeric required for backward compat (orchestrator reads min_score preferentially)
    result.required = rawRequired;
    logWarning(
      `Evaluator '${evaluatorName}' in '${evalId}': 'required: ${rawRequired}' is deprecated. ` +
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
    const expectedOutcome = asString(rawRubric.outcome) ?? '';
    const weight = typeof rawRubric.weight === 'number' ? rawRubric.weight : 1.0;

    // Parse min_score (0-1 scale), required_min_score (deprecated 0-10 scale), and required
    let minScore: number | undefined;
    let requiredMinScore: number | undefined;
    let required: boolean | undefined;

    if (typeof rawRubric.min_score === 'number') {
      // New field: 0-1 scale
      const ms = rawRubric.min_score as number;
      if (ms <= 0 || ms > 1) {
        throw new Error(
          `Invalid min_score for rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': must be in (0, 1] (got ${ms})`,
        );
      }
      minScore = ms;
      // Compute legacy required_min_score for backward compat with llm-grader internals
      requiredMinScore = Math.round(ms * 10);
    } else if (typeof rawRubric.required_min_score === 'number') {
      // Deprecated: 0-10 integer scale
      const rms = rawRubric.required_min_score as number;
      if (!Number.isInteger(rms) || rms < 0 || rms > 10) {
        throw new Error(
          `Invalid required_min_score for rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': must be an integer 0-10 (got ${rms})`,
        );
      }
      requiredMinScore = rms;
      minScore = rms / 10;
      logWarning(
        `Rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': 'required_min_score: ${rms}' is deprecated. ` +
          `Use 'min_score: ${rms / 10}' (0-1 scale) instead.`,
      );
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
        ...(required !== undefined ? { required } : {}),
        ...(minScore !== undefined ? { min_score: minScore } : {}),
        ...(requiredMinScore !== undefined ? { required_min_score: requiredMinScore } : {}),
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
        weight,
        // Default to required: true if not specified (backward compatibility)
        required: required ?? true,
        ...(minScore !== undefined ? { min_score: minScore } : {}),
        ...(requiredMinScore !== undefined ? { required_min_score: requiredMinScore } : {}),
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

/**
 * Parse inline rubrics field (syntactic sugar at eval case level).
 * Supports:
 * - String shorthand: "Must be polite" -> { id: "rubric-1", outcome: "Must be polite", weight: 1.0, required: true }
 * - Object form with outcome, weight, required, score_ranges, required_min_score
 *
 * Returns an LlmGraderEvaluatorConfig to prepend to evaluators, or undefined if no valid rubrics.
 */
export function parseInlineRubrics(
  rawRubrics: readonly unknown[],
): import('../types.js').LlmGraderEvaluatorConfig | undefined {
  const rubricItems = rawRubrics
    .filter((r): r is JsonObject | string => isJsonObject(r) || typeof r === 'string')
    .map((rubric, index) => {
      if (typeof rubric === 'string') {
        return {
          id: `rubric-${index + 1}`,
          outcome: rubric,
          weight: 1.0,
          required: true,
        };
      }

      const expectedOutcome = asString(rubric.outcome) ?? '';

      // Parse score_ranges if present (supports shorthand map format)
      const rawScoreRanges = rubric.score_ranges;
      const normalizedScoreRanges =
        rawScoreRanges !== undefined ? normalizeScoreRangesShorthand(rawScoreRanges) : undefined;
      const scoreRanges =
        Array.isArray(normalizedScoreRanges) && normalizedScoreRanges.length > 0
          ? normalizedScoreRanges
              .filter((r): r is JsonObject => isJsonObject(r))
              .map((range) => ({
                score_range: Array.isArray(range.score_range)
                  ? (range.score_range as unknown as readonly [number, number])
                  : ([0, 10] as const),
                outcome: asString(range.outcome) ?? '',
              }))
              .filter((r) => r.outcome.length > 0)
          : undefined;

      const baseRubric = {
        id: asString(rubric.id) ?? `rubric-${index + 1}`,
        weight: typeof rubric.weight === 'number' ? rubric.weight : 1.0,
      };

      // Parse min_score (0-1) or required_min_score (deprecated 0-10)
      let inlineMinScore: number | undefined;
      let inlineRequiredMinScore: number | undefined;
      if (typeof rubric.min_score === 'number') {
        inlineMinScore = rubric.min_score as number;
        inlineRequiredMinScore = Math.round(inlineMinScore * 10);
      } else if (typeof rubric.required_min_score === 'number') {
        inlineRequiredMinScore = rubric.required_min_score as number;
        inlineMinScore = inlineRequiredMinScore / 10;
      }

      // For score_ranges rubrics, outcome at rubric level is optional
      if (scoreRanges && scoreRanges.length > 0) {
        return {
          ...baseRubric,
          ...(expectedOutcome.length > 0 ? { outcome: expectedOutcome } : {}),
          ...(typeof rubric.required === 'boolean' ? { required: rubric.required } : {}),
          ...(inlineMinScore !== undefined ? { min_score: inlineMinScore } : {}),
          ...(inlineRequiredMinScore !== undefined
            ? { required_min_score: inlineRequiredMinScore }
            : {}),
          score_ranges: scoreRanges,
        };
      }

      // Checklist rubric: outcome is required
      return {
        ...baseRubric,
        outcome: expectedOutcome,
        required: typeof rubric.required === 'boolean' ? rubric.required : true,
        ...(inlineMinScore !== undefined ? { min_score: inlineMinScore } : {}),
        ...(inlineRequiredMinScore !== undefined
          ? { required_min_score: inlineRequiredMinScore }
          : {}),
      };
    })
    // Filter: must have outcome OR score_ranges
    .filter((r) => (r.outcome && r.outcome.length > 0) || ('score_ranges' in r && r.score_ranges));

  if (rubricItems.length === 0) {
    return undefined;
  }

  return {
    name: 'rubric',
    type: 'llm-grader',
    rubrics: rubricItems,
  };
}
