/**
 * `agentv results export` — converts JSONL eval results into a directory
 * structure matching the artifact-writer output format.
 *
 * Output structure:
 *   <output-dir>/
 *     benchmark.json           — aggregate scores, pass/fail counts, timing
 *     timing.json              — aggregate token usage and duration
 *     grading.json             — aggregate assertions across all tests
 *     grading/
 *       <test-id>.json         — per-test grading artifact (assertions, evaluators)
 *     outputs/
 *       <test-id>.md           — human-readable agent response per test
 *     inputs/
 *       <test-id>.md           — human-readable input messages per test
 *
 * This module delegates artifact building to the shared artifact-writer so
 * that `agentv results export` and `agentv eval` produce identical schemas.
 *
 * How to extend:
 *   - To change artifact schemas, update artifact-writer.ts (single source of truth).
 *   - To add new per-test output files, add a writer in `exportOutputs()`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';

import type { EvaluationResult } from '@agentv/core';
import {
  buildAggregateGradingArtifact,
  buildBenchmarkArtifact,
  buildGradingArtifact,
  buildTimingArtifact,
  parseJsonlResults,
} from '../eval/artifact-writer.js';
import { loadRunCache, resolveRunCacheFile } from '../eval/run-cache.js';
import { listResultFiles } from '../trace/utils.js';

// ── Export logic ─────────────────────────────────────────────────────────

export function exportResults(sourceFile: string, content: string, outputDir: string): void {
  const results = parseJsonlResults(content);

  if (results.length === 0) {
    throw new Error(`No results found in ${sourceFile}`);
  }

  // Patch testId for older JSONL files that used eval_id instead of test_id
  const patched = results.map((r) => {
    if (!r.testId && (r as unknown as Record<string, unknown>).evalId) {
      return { ...r, testId: String((r as unknown as Record<string, unknown>).evalId) };
    }
    return r;
  });

  mkdirSync(outputDir, { recursive: true });

  // benchmark.json — aggregate across all results
  const benchmark = buildBenchmarkArtifact(patched, sourceFile);
  writeFileSync(path.join(outputDir, 'benchmark.json'), `${JSON.stringify(benchmark, null, 2)}\n`);

  // timing.json — aggregate token usage and duration
  const timing = buildTimingArtifact(patched);
  writeFileSync(path.join(outputDir, 'timing.json'), `${JSON.stringify(timing, null, 2)}\n`);

  // grading.json — aggregate assertions across all tests
  const aggregateGrading = buildAggregateGradingArtifact(patched);
  writeFileSync(
    path.join(outputDir, 'grading.json'),
    `${JSON.stringify(aggregateGrading, null, 2)}\n`,
  );

  // grading/<test-id>.json — per-test grading artifacts
  const gradingDir = path.join(outputDir, 'grading');
  mkdirSync(gradingDir, { recursive: true });

  for (const result of patched) {
    const id = safeTestId(result);
    const grading = buildGradingArtifact(result);
    writeFileSync(path.join(gradingDir, `${id}.json`), `${JSON.stringify(grading, null, 2)}\n`);
  }

  // outputs/<test-id>.md — human-readable agent response text
  const outputsDir = path.join(outputDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });

  for (const result of patched) {
    if (result.output && result.output.length > 0) {
      const id = safeTestId(result);
      const md = formatOutputMarkdown(result.output);
      writeFileSync(path.join(outputsDir, `${id}.md`), md);
    }
  }

  // inputs/<test-id>.md — human-readable input messages per test
  const inputsDir = path.join(outputDir, 'inputs');
  mkdirSync(inputsDir, { recursive: true });

  for (const result of patched) {
    const id = safeTestId(result);
    const input = extractInput(result);
    if (input) {
      writeFileSync(path.join(inputsDir, `${id}.md`), input);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Format an output message array as human-readable markdown.
 * Each message becomes `@[role]:\n<content>\n\n`.
 */
function formatOutputMarkdown(output: readonly { role: string; content?: unknown }[]): string {
  return output.map((msg) => `@[${msg.role}]:\n${String(msg.content ?? '')}`).join('\n\n');
}

/**
 * Extract human-readable input from a result.
 * Handles both string input (single question) and Message[] input (multi-message).
 */
function extractInput(result: EvaluationResult): string | null {
  const input = (result as unknown as Record<string, unknown>).input;
  if (!input) return null;
  if (typeof input === 'string') return input;
  if (Array.isArray(input) && input.length > 0) {
    return formatOutputMarkdown(input as { role: string; content?: unknown }[]);
  }
  return null;
}

/**
 * Extract a safe filename from a test ID, handling older JSONL formats
 * that used `eval_id` instead of `test_id`.
 */
function safeTestId(result: EvaluationResult): string {
  const raw = result.testId ?? (result as unknown as Record<string, unknown>).evalId ?? 'unknown';
  return String(raw).replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Derive the default output directory from a JSONL source path.
 * Handles both directory-per-run (eval_<ts>/results.jsonl) and legacy flat files (eval_<ts>.jsonl).
 */
function deriveOutputDir(cwd: string, sourceFile: string): string {
  const parentDir = path.basename(path.dirname(sourceFile));
  if (parentDir.startsWith('eval_')) {
    // New directory-per-run: extract timestamp from parent dir name
    const dirName = parentDir.slice(5);
    return path.join(cwd, '.agentv', 'results', 'export', dirName);
  }
  // Legacy flat file: extract timestamp from filename
  const basename = path.basename(sourceFile, '.jsonl');
  const dirName = basename.startsWith('eval_') ? basename.slice(5) : basename;
  return path.join(cwd, '.agentv', 'results', 'export', dirName);
}

// ── CLI command ──────────────────────────────────────────────────────────

export const resultsExportCommand = command({
  name: 'export',
  description: 'Export JSONL eval results into a per-test directory structure',
  args: {
    source: positional({
      type: optional(string),
      displayName: 'source',
      description: 'JSONL result file to export (defaults to most recent in .agentv/results/)',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      short: 'o',
      description: 'Output directory (defaults to .agentv/results/export/<run-timestamp>/)',
    }),
    dir: option({
      type: optional(string),
      long: 'dir',
      short: 'd',
      description: 'Working directory (default: current directory)',
    }),
  },
  handler: async ({ source, out, dir }) => {
    const cwd = dir ?? process.cwd();

    try {
      let sourceFile: string;

      if (source) {
        // Explicit source file
        sourceFile = path.isAbsolute(source) ? source : path.resolve(cwd, source);
      } else {
        // Prefer cache pointer, fall back to directory scan
        const cache = await loadRunCache(cwd);
        const cachedFile = cache ? resolveRunCacheFile(cache) : '';
        if (cachedFile && existsSync(cachedFile)) {
          sourceFile = cachedFile;
        } else {
          const metas = listResultFiles(cwd, 1);
          if (metas.length === 0) {
            console.error('Error: No result files found in .agentv/results/');
            console.error('Run an evaluation first: agentv eval <eval-file>');
            process.exit(1);
          }
          sourceFile = metas[0].path;
        }
      }

      const content = readFileSync(sourceFile, 'utf8');

      const outputDir = out
        ? path.isAbsolute(out)
          ? out
          : path.resolve(cwd, out)
        : deriveOutputDir(cwd, sourceFile);

      exportResults(sourceFile, content, outputDir);

      // Report exported test IDs
      const results = parseJsonlResults(content);
      console.log(`Exported ${results.length} test(s) to ${outputDir}`);
      for (const result of results) {
        const id =
          result.testId ?? (result as unknown as Record<string, unknown>).evalId ?? 'unknown';
        console.log(`  ${id}`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
