import path from "node:path";

import { resolveFileReference } from "./file-resolver.js";
import type { EvaluatorConfig, EvaluatorKind, JsonObject, JsonValue } from "../types.js";
import { isEvaluatorKind } from "../types.js";

const ANSI_YELLOW = "\u001b[33m";
const ANSI_RESET = "\u001b[0m";

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
    ? execution.evaluators ?? rawEvalCase.evaluators 
    : rawEvalCase.evaluators ?? globalExecution?.evaluators;
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

    if (typeValue === "code") {
      const script = asString(rawEvaluator.script);
      if (!script) {
        logWarning(`Skipping code evaluator '${name}' in '${evalId}': missing script`);
        continue;
      }

      const cwd = asString(rawEvaluator.cwd);
      let resolvedCwd: string | undefined;

      // Resolve cwd if provided (relative to eval file), otherwise default to eval file directory
      if (cwd) {
        const resolved = await resolveFileReference(cwd, searchRoots);
        if (resolved.resolvedPath) {
          resolvedCwd = path.resolve(resolved.resolvedPath);
        } else {
          logWarning(
            `Code evaluator '${name}' in '${evalId}': cwd not found (${resolved.displayPath})`,
            resolved.attempted.length > 0 ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`) : undefined,
          );
        }
      } else {
        // Default to the directory containing the eval file (first search root)
        resolvedCwd = searchRoots[0];
      }

      evaluators.push({
        name,
        type: "code",
        script,
        cwd,
        resolvedCwd,
      });
      continue;
    }

    const prompt = asString(rawEvaluator.prompt);
    let promptPath: string | undefined;
    if (prompt) {
      const resolved = await resolveFileReference(prompt, searchRoots);
      if (resolved.resolvedPath) {
        promptPath = path.resolve(resolved.resolvedPath);
      } else {
        logWarning(
          `Inline prompt used for evaluator '${name}' in '${evalId}' (file not found: ${resolved.displayPath})`,
          resolved.attempted.length > 0 ? resolved.attempted.map((attempt) => `  Tried: ${attempt}`) : undefined,
        );
      }
    }

    const model = asString(rawEvaluator.model);

    evaluators.push({
      name,
      type: "llm_judge",
      prompt,
      promptPath
    });
  }

  return evaluators.length > 0 ? evaluators : undefined;
}

/**
 * Coerce evaluator value to valid EvaluatorKind.
 */
export function coerceEvaluator(candidate: JsonValue | undefined, contextId: string): EvaluatorKind | undefined {
  if (typeof candidate !== "string") {
    return undefined;
  }
  if (isEvaluatorKind(candidate)) {
    return candidate;
  }
  logWarning(`Unknown evaluator '${candidate}' in ${contextId}, falling back to default`);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logWarning(message: string, details?: readonly string[]): void {
  if (details && details.length > 0) {
    const detailBlock = details.join("\n");
    console.warn(`${ANSI_YELLOW}Warning: ${message}\n${detailBlock}${ANSI_RESET}`);
  } else {
    console.warn(`${ANSI_YELLOW}Warning: ${message}${ANSI_RESET}`);
  }
}
