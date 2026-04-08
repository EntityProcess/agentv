/**
 * `agentv import huggingface` — Import a HuggingFace dataset into AgentV EVAL.yaml format.
 *
 * Wraps the Python script `scripts/import-huggingface.py` which uses the
 * `datasets` library to load from HuggingFace Hub and converts instances
 * (e.g. SWE-bench) into individual .EVAL.yaml files.
 *
 * The Python script is executed via `uv run` (per repo convention for Python
 * scripts). The `uv` tool auto-installs script dependencies from the inline
 * metadata block.
 *
 * Usage:
 *   agentv import huggingface --repo SWE-bench/SWE-bench_Verified --split test --limit 10 --output evals/swebench/
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { command, number, option, optional, string } from 'cmd-ts';

/**
 * Resolve the path to the import-huggingface.py script.
 *
 * Searches upward from the CLI package directory to find the repo root
 * (where scripts/ lives). Falls back to cwd-relative path.
 */
function findScript(): string {
  // Try relative to this file's compiled location (apps/cli/dist/ or apps/cli/src/)
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'import-huggingface.py'),
    path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'import-huggingface.py'),
    path.resolve(process.cwd(), 'scripts', 'import-huggingface.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1]; // fallback to cwd-relative
}

export const importHuggingFaceCommand = command({
  name: 'huggingface',
  description: 'Import a HuggingFace dataset into AgentV EVAL.yaml format',
  args: {
    repo: option({
      type: string,
      long: 'repo',
      description: 'HuggingFace dataset repository (e.g. SWE-bench/SWE-bench_Verified)',
    }),
    split: option({
      type: optional(string),
      long: 'split',
      description: 'Dataset split to load (default: test)',
    }),
    limit: option({
      type: optional(number),
      long: 'limit',
      description: 'Maximum number of instances to import',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Output directory for EVAL.yaml files (default: evals/)',
    }),
  },
  handler: async ({ repo, split, limit, output }) => {
    const scriptPath = findScript();

    if (!existsSync(scriptPath)) {
      console.error(`Error: Python script not found at ${scriptPath}`);
      console.error(
        'Make sure you are running from the agentv repository root, or install agentv from source.',
      );
      process.exit(1);
    }

    // Build arguments for the Python script
    const args = [scriptPath, '--repo', repo];
    if (split) args.push('--split', split);
    if (limit !== undefined) args.push('--limit', String(limit));
    if (output) args.push('--output', output);

    console.log(`Importing from HuggingFace: ${repo} (split=${split ?? 'test'})...`);

    // Execute via uv run
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'uv',
          ['run', ...args],
          { maxBuffer: 50 * 1024 * 1024 },
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          },
        );

        // Collect stderr for error reporting
        let stderrBuf = '';
        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderrBuf += chunk;
          process.stderr.write(data);
        });

        // Capture stdout (JSON summary)
        let stdout = '';
        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0 && stdout.trim()) {
            try {
              const summary = JSON.parse(stdout.trim());
              console.log(
                `\nImported ${summary.files_created} eval(s) from ${summary.dataset} → ${summary.output_dir}/`,
              );
            } catch {
              // If JSON parsing fails, just print raw output
              if (stdout.trim()) console.log(stdout.trim());
            }
          } else if (code !== 0) {
            // Surface a bounded stderr summary so the user sees what went wrong
            const tail = stderrBuf.trim().slice(-2000);
            if (tail) {
              console.error(`\n--- import-huggingface.py stderr (last 2 000 chars) ---`);
              console.error(tail);
            }
          }
        });
      });
    } catch (err: unknown) {
      // Handle missing `uv` binary (ENOENT) with a clear message
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(
          'Error: `uv` is not installed or not found on PATH.\n' +
            'Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh\n' +
            'See https://docs.astral.sh/uv/ for details.',
        );
        process.exit(1);
      }
      throw err;
    }
  },
});
