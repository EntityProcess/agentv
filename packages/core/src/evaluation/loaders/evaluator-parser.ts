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
  // Priority: case-level execution.evaluators > case-level evaluators > global execution.evaluators
  const candidateEvaluators = isJsonObject(execution)
    ? (execution.evaluators ?? rawEvalCase.evaluators)
    : (rawEvalCase.evaluators ?? globalExecution?.evaluators);
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
      const script = asString(rawEvaluator.script);
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

      evaluators.push({
        name,
        type: 'code',
        script,
        cwd,
        resolvedCwd,
        ...(weight !== undefined ? { weight } : {}),
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

        // Don't try to resolve if path contains a command (e.g., "node script.js", "uv run script.py")
        // This matches the behavior of code evaluators which accept full commands
        // Set cwd to eval file directory (first search root)
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
            expected.push({ tool: item.tool });
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

    const prompt = asString(rawEvaluator.prompt);
    let promptPath: string | undefined;
    if (prompt) {
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
      ? rawRubrics
          .filter((r): r is JsonObject => isJsonObject(r))
          .map((rubric, index) => ({
            id: asString(rubric.id) ?? `rubric-${index + 1}`,
            description: asString(rubric.description) ?? '',
            weight: typeof rubric.weight === 'number' ? rubric.weight : 1.0,
            required: typeof rubric.required === 'boolean' ? rubric.required : true,
          }))
          .filter((r) => r.description.length > 0)
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

    evaluators.push({
      name,
      type: 'llm_judge',
      prompt,
      promptPath,
      ...(parsedRubrics && parsedRubrics.length > 0 ? { rubrics: parsedRubrics } : {}),
      ...(weight !== undefined ? { weight } : {}),
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
