/**
 * `agentv results export` — converts JSONL eval results into a directory
 * structure matching the artifact-writer output format.
 *
 * Output structure:
 *   <output-dir>/
 *     benchmark.json           — aggregate scores, pass/fail counts, timing
 *     timing.json              — aggregate token usage and duration
 *     grading/
 *       <test-id>.json         — per-test grading artifact (assertions, evaluators)
 *     outputs/
 *       <test-id>.txt          — raw agent response text per test
 *
 * This module delegates artifact building to the shared artifact-writer so
 * that `agentv results export` and `agentv eval` produce identical schemas.
 *
 * How to extend:
 *   - To change artifact schemas, update artifact-writer.ts (single source of truth).
 *   - To add new per-test output files, add a writer in `exportOutputs()`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';

import type { EvaluationResult } from '@agentv/core';
import {
  buildBenchmarkArtifact,
  buildGradingArtifact,
  buildTimingArtifact,
  parseJsonlResults,
} from '../eval/artifact-writer.js';
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

  // grading/<test-id>.json — per-test grading artifacts
  const gradingDir = path.join(outputDir, 'grading');
  mkdirSync(gradingDir, { recursive: true });

  for (const result of patched) {
    const id = safeTestId(result);
    const grading = buildGradingArtifact(result);
    writeFileSync(path.join(gradingDir, `${id}.json`), `${JSON.stringify(grading, null, 2)}\n`);
  }

  // outputs/<test-id>.txt — raw agent response text
  const outputsDir = path.join(outputDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });

  for (const result of patched) {
    // Extract output text: prefer `output` (Message[]), fall back to legacy `outputText` (string)
    const r = result as unknown as Record<string, unknown>;
    let outputContent: string | undefined;
    if (result.output && result.output.length > 0) {
      outputContent = JSON.stringify(result.output, null, 2);
    } else if (typeof r.outputText === 'string' && r.outputText) {
      outputContent = r.outputText;
    }
    if (outputContent) {
      const id = safeTestId(result);
      writeFileSync(path.join(outputsDir, `${id}.txt`), outputContent);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract a safe filename from a test ID, handling older JSONL formats
 * that used `eval_id` instead of `test_id`.
 */
function safeTestId(result: EvaluationResult): string {
  const raw = result.testId ?? (result as unknown as Record<string, unknown>).evalId ?? 'unknown';
  return String(raw).replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Derive the default output directory from a JSONL filename.
 * e.g. eval_2026-03-18T12-00-00-000Z.jsonl → .agentv/results/2026-03-18T12-00-00-000Z/
 */
function deriveOutputDir(cwd: string, sourceFile: string): string {
  const basename = path.basename(sourceFile, '.jsonl');
  // Strip leading "eval_" prefix if present to get the timestamp
  const dirName = basename.startsWith('eval_') ? basename.slice(5) : basename;
  return path.join(cwd, '.agentv', 'results', dirName);
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
      description: 'Output directory (defaults to .agentv/results/<run-timestamp>/)',
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
        // Find most recent result file
        const metas = listResultFiles(cwd, 1);
        if (metas.length === 0) {
          console.error('Error: No result files found in .agentv/results/');
          console.error('Run an evaluation first: agentv eval <eval-file>');
          process.exit(1);
        }
        sourceFile = metas[0].path;
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
