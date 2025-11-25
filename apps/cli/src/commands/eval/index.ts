import type { Command } from "commander";
import fg from "fast-glob";
import { stat } from "node:fs/promises";
import path from "node:path";

import { runEvalCommand } from "./run-eval.js";

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

export function registerEvalCommand(program: Command): Command {
  program
    .command("eval")
    .description("Run eval suites and report results")
    .argument("<eval-paths...>", "Path(s) or glob(s) to evaluation .yaml file(s)")
    .option("--target <name>", "Override target name from targets.yaml", "default")
    .option("--targets <path>", "Path to targets.yaml (overrides discovery)")
    .option("--eval-id <id>", "Run only the eval case with this identifier")
    .option(
      "--workers <count>",
      "Number of parallel workers (default: 1, max: 50). Can also be set per-target in targets.yaml",
      (value) => parseInteger(value, 1),
    )
    .option("--out <path>", "Write results to the specified path")
    .option(
      "--output-format <format>",
      "Output format: 'jsonl' or 'yaml' (default: jsonl)",
      "jsonl",
    )
    .option("--dry-run", "Use mock provider responses instead of real LLM calls", false)
    .option(
      "--dry-run-delay <ms>",
      "Fixed delay in milliseconds for dry-run mode (overridden by delay range if specified)",
      (value) => parseInteger(value, 0),
      0,
    )
    .option(
      "--dry-run-delay-min <ms>",
      "Minimum delay in milliseconds for dry-run mode (requires --dry-run-delay-max)",
      (value) => parseInteger(value, 0),
      0,
    )
    .option(
      "--dry-run-delay-max <ms>",
      "Maximum delay in milliseconds for dry-run mode (requires --dry-run-delay-min)",
      (value) => parseInteger(value, 0),
      0,
    )
    .option(
      "--agent-timeout <seconds>",
      "Timeout in seconds for provider responses (default: 120)",
      (value) => parseInteger(value, 120),
      120,
    )
    .option(
      "--max-retries <count>",
      "Retry count for timeout recoveries (default: 2)",
      (value) => parseInteger(value, 2),
      2,
    )
    .option("--cache", "Enable in-memory provider response cache", false)
    .option("--verbose", "Enable verbose logging", false)
    .option(
      "--dump-prompts [dir]",
      "Persist prompt payloads for debugging (optional custom directory)",
    )
    .action(async (evalPaths: string[], rawOptions: Record<string, unknown>) => {
      const resolvedPaths = await resolveEvalPaths(evalPaths, process.cwd());
      await runEvalCommand({ testFiles: resolvedPaths, rawOptions });
    });

  return program;
}

async function resolveEvalPaths(evalPaths: string[], cwd: string): Promise<string[]> {
  const normalizedInputs = evalPaths.map((value) => value?.trim()).filter((value) => value);
  if (normalizedInputs.length === 0) {
    throw new Error("No eval paths provided.");
  }

  const unmatched: string[] = [];
  const results = new Set<string>();

  for (const pattern of normalizedInputs) {
    // If the pattern points to an existing file, short-circuit globbing
    const candidatePath = path.isAbsolute(pattern)
      ? path.normalize(pattern)
      : path.resolve(cwd, pattern);
    try {
      const stats = await stat(candidatePath);
      if (stats.isFile() && /\.ya?ml$/i.test(candidatePath)) {
        results.add(candidatePath);
        continue;
      }
    } catch {
      // fall through to glob matching
    }

    const globPattern = pattern.includes("\\") ? pattern.replace(/\\/g, "/") : pattern;
    const matches = await fg(globPattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: true,
      followSymbolicLinks: true,
    });

    const yamlMatches = matches.filter((filePath) => /\.ya?ml$/i.test(filePath));
    if (yamlMatches.length === 0) {
      unmatched.push(pattern);
      continue;
    }

    yamlMatches.forEach((filePath) => results.add(path.normalize(filePath)));
  }

  if (unmatched.length > 0) {
    throw new Error(
      `No eval files matched: ${unmatched.join(
        ", ",
      )}. Provide YAML paths or globs (e.g., "evals/**/*.yaml").`,
    );
  }

  const sorted = Array.from(results);
  sorted.sort();
  return sorted;
}
