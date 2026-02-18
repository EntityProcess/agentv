import path from 'node:path';

import type { ToolTrajectoryEvaluatorConfig, ToolTrajectoryExpectedItem } from '../trace.js';
import type { EvaluatorConfig, EvaluatorKind, JsonObject, JsonValue } from '../types.js';
import { isEvaluatorKind } from '../types.js';
import { validateCustomPromptContent } from '../validation/prompt-validator.js';
import { resolveFileReference } from './file-resolver.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RESET = '\u001b[0m';

/**
 * Parse evaluators from eval case configuration.
 */
export async function parseEvaluators(
  rawEvalCase: JsonObject & {
    readonly execution?: JsonValue;
    readonly evaluators?: JsonValue;
  },
  globalExecution: JsonObject | undefined,
  searchRoots: readonly string[],
  evalId: string,
): Promise<readonly EvaluatorConfig[] | undefined> {
  const execution = rawEvalCase.execution;
  const executionObject = isJsonObject(execution) ? execution : undefined;

  // Priority: case-level execution.evaluators > case-level evaluators > global execution.evaluators
  // Note: If a case has an execution object but omits evaluators, we MUST still fall back to the
  // suite-level execution.evaluators (otherwise adding constraints at case-level disables inheritance).
  const candidateEvaluators =
    (executionObject ? executionObject.evaluators : undefined) ??
    rawEvalCase.evaluators ??
    globalExecution?.evaluators;
  if (candidateEvaluators === undefined) {
    return undefined;
  }

  if (!Array.isArray(candidateEvaluators)) {
    logWarning(`Skipping evaluators for '${evalId}': expected array`);
    return undefined;
  }

  const evaluators: EvaluatorConfig[] = [];

  for (const rawEvaluator of candidateEvaluators) {
    if (!isJsonObject(rawEvaluator)) {
      logWarning(`Skipping invalid evaluator entry for '${evalId}' (expected object)`);
      continue;
    }

    const name = asString(rawEvaluator.name);
    const typeValue = rawEvaluator.type;

    if (!name || !isEvaluatorKind(typeValue)) {
      logWarning(`Skipping evaluator with invalid name/type in '${evalId}'`);
      continue;
    }

    if (typeValue === 'code_judge') {
      let script: string[] | undefined;
      const rawScript = rawEvaluator.script;

      if (typeof rawScript === 'string') {
        const trimmed = rawScript.trim();
        if (trimmed.length === 0) {
          throw new Error(
            `Invalid code_judge script for evaluator '${name}' in '${evalId}': script cannot be empty`,
          );
        }
        script = parseCommandToArgv(trimmed);
      } else {
        script = asStringArray(
          rawScript,
          `code_judge script for evaluator '${name}' in '${evalId}'`,
        );
      }

      if (!script) {
        logWarning(`Skipping code_judge evaluator '${name}' in '${evalId}': missing script`);
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
            `Code_judge evaluator '${name}' in '${evalId}': cwd not found (${resolved.displayPath})`,
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

      // Collect unrecognized properties as pass-through config
      const knownProps = new Set(['name', 'type', 'script', 'cwd', 'weight', 'target']);
      const config: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(rawEvaluator)) {
        if (!knownProps.has(key) && value !== undefined) {
          config[key] = value as JsonValue;
        }
      }

      evaluators.push({
        name,
        type: 'code',
        script,
        cwd,
        resolvedCwd,
        ...(weight !== undefined ? { weight } : {}),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ...(targetConfig !== undefined ? { target: targetConfig } : {}),
      });
      continue;
    }

    if (typeValue === 'composite') {
      const rawMembers = rawEvaluator.evaluators;
      if (!Array.isArray(rawMembers)) {
        logWarning(
          `Skipping composite evaluator '${name}' in '${evalId}': missing evaluators array`,
        );
        continue;
      }

      const rawAggregator = rawEvaluator.aggregator;
      if (!isJsonObject(rawAggregator)) {
        logWarning(`Skipping composite evaluator '${name}' in '${evalId}': missing aggregator`);
        continue;
      }

      const aggregatorType = asString(rawAggregator.type);
      if (
        aggregatorType !== 'weighted_average' &&
        aggregatorType !== 'code_judge' &&
        aggregatorType !== 'llm_judge'
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

        // Parse member evaluator (reuse existing logic for code, llm_judge, code_judge)
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

      if (aggregatorType === 'weighted_average') {
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
      } else if (aggregatorType === 'code_judge') {
        const aggregatorPath = asString(rawAggregator.path);
        if (!aggregatorPath) {
          logWarning(
            `Skipping composite evaluator '${name}' in '${evalId}': code_judge aggregator missing path`,
          );
          continue;
        }

        // Set cwd to eval file directory (first search root)
        // Paths are resolved relative to this directory
        aggregator = {
          type: 'code_judge',
          path: aggregatorPath,
          cwd: searchRoots[0],
        };
      } else {
        // llm_judge aggregator
        const aggregatorPrompt = asString(rawAggregator.prompt);
        let promptPath: string | undefined;

        if (aggregatorPrompt) {
          const resolved = await resolveFileReference(aggregatorPrompt, searchRoots);
          if (resolved.resolvedPath) {
            promptPath = path.resolve(resolved.resolvedPath);
          }
        }

        aggregator = {
          type: 'llm_judge',
          ...(aggregatorPrompt ? { prompt: aggregatorPrompt } : {}),
          ...(promptPath ? { promptPath } : {}),
        };
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      evaluators.push({
        name,
        type: 'composite',
        evaluators: memberEvaluators,
        aggregator,
        ...(weight !== undefined ? { weight } : {}),
      });
      continue;
    }

    if (typeValue === 'tool_trajectory') {
      const mode = asString(rawEvaluator.mode);
      if (mode !== 'any_order' && mode !== 'in_order' && mode !== 'exact') {
        logWarning(
          `Skipping tool_trajectory evaluator '${name}' in '${evalId}': invalid mode '${mode}' (must be any_order, in_order, or exact)`,
        );
        continue;
      }

      const rawMinimums = rawEvaluator.minimums;
      let minimums: Record<string, number> | undefined;
      if (rawMinimums !== undefined) {
        if (!isJsonObject(rawMinimums)) {
          logWarning(
            `Skipping tool_trajectory evaluator '${name}' in '${evalId}': minimums must be an object`,
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

      const rawExpected = rawEvaluator.expected;
      let expected: ToolTrajectoryExpectedItem[] | undefined;
      if (rawExpected !== undefined) {
        if (!Array.isArray(rawExpected)) {
          logWarning(
            `Skipping tool_trajectory evaluator '${name}' in '${evalId}': expected must be an array`,
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
            expected.push({ tool: item.tool, ...(args !== undefined ? { args } : {}) });
          }
        }
      }

      // Validate config completeness based on mode
      if (mode === 'any_order' && !minimums) {
        logWarning(
          `Skipping tool_trajectory evaluator '${name}' in '${evalId}': any_order mode requires minimums`,
        );
        continue;
      }

      if ((mode === 'in_order' || mode === 'exact') && !expected) {
        logWarning(
          `Skipping tool_trajectory evaluator '${name}' in '${evalId}': ${mode} mode requires expected`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      const config: ToolTrajectoryEvaluatorConfig = {
        name,
        type: 'tool_trajectory',
        mode,
        ...(minimums ? { minimums } : {}),
        ...(expected ? { expected } : {}),
        ...(weight !== undefined ? { weight } : {}),
      };

      evaluators.push(config);
      continue;
    }

    if (typeValue === 'field_accuracy') {
      const rawFields = rawEvaluator.fields;
      if (!Array.isArray(rawFields)) {
        logWarning(
          `Skipping field_accuracy evaluator '${name}' in '${evalId}': missing fields array`,
        );
        continue;
      }

      if (rawFields.length === 0) {
        logWarning(
          `Skipping field_accuracy evaluator '${name}' in '${evalId}': fields array is empty`,
        );
        continue;
      }

      const fields: import('../types.js').FieldConfig[] = [];
      for (const rawField of rawFields) {
        if (!isJsonObject(rawField)) {
          logWarning(
            `Skipping invalid field entry in field_accuracy evaluator '${name}' (expected object)`,
          );
          continue;
        }

        const fieldPath = asString(rawField.path);
        const match = asString(rawField.match);

        if (!fieldPath) {
          logWarning(
            `Skipping field without path in field_accuracy evaluator '${name}' in '${evalId}'`,
          );
          continue;
        }

        if (!match || !isValidFieldMatchType(match)) {
          logWarning(
            `Skipping field '${fieldPath}' with invalid match type '${match}' in evaluator '${name}' (must be exact, numeric_tolerance, or date). For fuzzy matching, use a code_judge evaluator.`,
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
          `Skipping field_accuracy evaluator '${name}' in '${evalId}': no valid fields found`,
        );
        continue;
      }

      const aggregation = asString(rawEvaluator.aggregation);
      const validAggregation = isValidFieldAggregationType(aggregation) ? aggregation : undefined;

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      evaluators.push({
        name,
        type: 'field_accuracy',
        fields,
        ...(validAggregation ? { aggregation: validAggregation } : {}),
        ...(weight !== undefined ? { weight } : {}),
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

      evaluators.push({
        name,
        type: 'latency',
        threshold,
        ...(weight !== undefined ? { weight } : {}),
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

      evaluators.push({
        name,
        type: 'cost',
        budget,
        ...(weight !== undefined ? { weight } : {}),
      });
      continue;
    }

    if (typeValue === 'token_usage') {
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
            `Skipping token_usage evaluator '${name}' in '${evalId}': ${key} must be a non-negative finite number`,
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
          `Skipping token_usage evaluator '${name}' in '${evalId}': must set at least one of max_total, max_input, max_output`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      evaluators.push({
        name,
        type: 'token_usage',
        ...validLimits,
        ...(weight !== undefined ? { weight } : {}),
      });
      continue;
    }

    if (typeValue === 'execution_metrics') {
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
            `Skipping execution_metrics evaluator '${name}' in '${evalId}': ${key} must be a non-negative finite number`,
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
          `Skipping execution_metrics evaluator '${name}' in '${evalId}': must set at least one threshold (max_tool_calls, max_llm_calls, max_tokens, max_cost_usd, max_duration_ms, or target_exploration_ratio)`,
        );
        continue;
      }

      const weight = validateWeight(rawEvaluator.weight, name, evalId);

      evaluators.push({
        name,
        type: 'execution_metrics',
        ...validThresholds,
        ...(weight !== undefined ? { weight } : {}),
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
      // Executable prompt template: { script: [...], config: {...} }
      const scriptArray = asStringArray(
        rawPrompt.script,
        `prompt.script for evaluator '${name}' in '${evalId}'`,
      );

      if (!scriptArray) {
        throw new Error(`Evaluator '${name}' in '${evalId}': prompt object requires script array`);
      }

      // Resolve the script path (last element is typically the file path)
      const scriptPath = scriptArray[scriptArray.length - 1];
      const resolved = await resolveFileReference(scriptPath, searchRoots);

      if (resolved.resolvedPath) {
        // Replace the last element with the resolved path
        resolvedPromptScript = [...scriptArray.slice(0, -1), path.resolve(resolved.resolvedPath)];
      } else {
        throw new Error(
          `Evaluator '${name}' in '${evalId}': prompt script file not found: ${resolved.displayPath}`,
        );
      }

      // Extract config from prompt object
      if (isJsonObject(rawPrompt.config)) {
        promptScriptConfig = rawPrompt.config as Record<string, unknown>;
      }
    } else if (typeof rawPrompt === 'string') {
      // Text template prompt (existing behavior)
      prompt = rawPrompt;
      const resolved = await resolveFileReference(prompt, searchRoots);
      if (resolved.resolvedPath) {
        promptPath = path.resolve(resolved.resolvedPath);
        // Validate custom prompt content upfront - throws error if validation fails
        try {
          await validateCustomPromptContent(promptPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Add context and re-throw for the caller to handle
          throw new Error(`Evaluator '${name}' template (${promptPath}): ${message}`);
        }
      } else {
        logWarning(
          `Inline prompt used for evaluator '${name}' in '${evalId}' (file not found: ${resolved.displayPath})`,
          resolved.attempted.length > 0
            ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`)
            : undefined,
        );
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

      // Back-compat: `type: rubric` maps to `type: llm_judge` with `rubrics`.
      evaluators.push({
        name,
        type: 'llm_judge',
        rubrics: parsedRubrics,
        ...(weight !== undefined ? { weight } : {}),
      });
      continue;
    }

    const weight = validateWeight(rawEvaluator.weight, name, evalId);

    // Collect unrecognized properties as pass-through config (for text prompt templates)
    // Note: For script prompts, config comes from prompt.config instead
    const knownProps = new Set(['name', 'type', 'prompt', 'model', 'rubrics', 'weight', 'config']);
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

    evaluators.push({
      name,
      type: 'llm_judge',
      prompt,
      promptPath,
      ...(promptPath ? { resolvedPromptPath: promptPath } : {}),
      ...(resolvedPromptScript ? { resolvedPromptScript } : {}),
      ...(parsedRubrics && parsedRubrics.length > 0 ? { rubrics: parsedRubrics } : {}),
      ...(weight !== undefined ? { weight } : {}),
      ...(finalConfig ? { config: finalConfig } : {}),
    });
  }

  return evaluators.length > 0 ? evaluators : undefined;
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
  if (isEvaluatorKind(candidate)) {
    return candidate;
  }
  logWarning(`Unknown evaluator '${candidate}' in ${contextId}, falling back to default`);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join('\n');
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
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

    // Parse required_min_score (new) or required (legacy backward compat)
    let requiredMinScore: number | undefined;
    let required: boolean | undefined;

    if (typeof rawRubric.required_min_score === 'number') {
      const minScore = rawRubric.required_min_score;
      if (!Number.isInteger(minScore) || minScore < 0 || minScore > 10) {
        throw new Error(
          `Invalid required_min_score for rubric '${id}' in evaluator '${evaluatorName}' in '${evalId}': must be an integer 0-10 (got ${minScore})`,
        );
      }
      requiredMinScore = minScore;
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
 * Returns an LlmJudgeEvaluatorConfig to prepend to evaluators, or undefined if no valid rubrics.
 */
export function parseInlineRubrics(
  rawRubrics: readonly unknown[],
): import('../types.js').LlmJudgeEvaluatorConfig | undefined {
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

      // For score_ranges rubrics, outcome at rubric level is optional
      if (scoreRanges && scoreRanges.length > 0) {
        return {
          ...baseRubric,
          ...(expectedOutcome.length > 0 ? { outcome: expectedOutcome } : {}),
          ...(typeof rubric.required === 'boolean' ? { required: rubric.required } : {}),
          ...(typeof rubric.required_min_score === 'number'
            ? { required_min_score: rubric.required_min_score }
            : {}),
          score_ranges: scoreRanges,
        };
      }

      // Checklist rubric: outcome is required
      return {
        ...baseRubric,
        outcome: expectedOutcome,
        required: typeof rubric.required === 'boolean' ? rubric.required : true,
        ...(typeof rubric.required_min_score === 'number'
          ? { required_min_score: rubric.required_min_score }
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
    type: 'llm_judge',
    rubrics: rubricItems,
  };
}
