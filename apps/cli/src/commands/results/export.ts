/**
 * `agentv results export` — converts JSONL eval results into a directory
 * structure matching the artifact-writer output format.
 *
 * Output structure:
 *   <output-dir>/
 *     benchmark.json           — aggregate scores, pass/fail counts, timing
 *     index.jsonl              — per-test manifest with artifact pointers
 *     <test-id>/
 *       grading.json           — per-test grading artifact (assertions, evaluators)
 *       timing.json            — per-test timing artifact
 *       outputs/
 *         response.md          — human-readable agent response for this test
 *       input.md               — human-readable input messages for this test
 *
 * This module delegates artifact building to the shared artifact-writer so
 * that benchmark/grading/timing schemas stay aligned with `agentv eval`.
 *
 * How to extend:
 *   - To change artifact schemas, update artifact-writer.ts (single source of truth).
 *   - To add new per-test workspace files, add them under each test directory.
 */

import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';

import { parseJsonlResults, writeArtifactsFromResults } from '../eval/artifact-writer.js';
import { loadResults as loadSharedResults, patchTestIds, resolveSourceFile } from './shared.js';

// ── Export logic ─────────────────────────────────────────────────────────

export async function exportResults(
  sourceFile: string,
  content: string,
  outputDir: string,
): Promise<void> {
  const results = parseJsonlResults(content);

  if (results.length === 0) {
    throw new Error(`No results found in ${sourceFile}`);
  }

  await writeArtifactsFromResults(patchTestIds(results), outputDir, {
    evalFile: sourceFile,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the default output directory from a JSONL source path.
 * Handles both directory-per-run manifests (eval_<ts>/index.jsonl) and legacy flat files.
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
      const { sourceFile } = await resolveSourceFile(source, cwd);
      const { results } = await loadSharedResults(source, cwd);

      const outputDir = out
        ? path.isAbsolute(out)
          ? out
          : path.resolve(cwd, out)
        : deriveOutputDir(cwd, sourceFile);

      await writeArtifactsFromResults(results, outputDir, {
        evalFile: sourceFile,
      });

      // Report exported test IDs
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
