#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { toCamelCaseDeep, toSnakeCaseDeep, trimBaselineResult } from '@agentv/core';
import type { EvaluationResult } from '@agentv/core';

type CliOptions = {
  threshold?: string;
  evalFile?: string;
  update: boolean;
  dryRun: boolean;
};

const repoRoot = path.resolve(__dirname, '..');
const examplesRoot = path.join(repoRoot, 'examples');

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    update: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--threshold') {
      options.threshold = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--eval-file') {
      options.evalFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--update') {
      options.update = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

async function findBaselineFiles(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findBaselineFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.baseline.jsonl')) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveEvalFile(baselinePath: string): string {
  const yamlPath = baselinePath.replace(/\.baseline\.jsonl$/, '.yaml');
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = baselinePath.replace(/\.baseline\.jsonl$/, '.yml');
  if (existsSync(ymlPath)) {
    return ymlPath;
  }
  throw new Error(`Eval file not found for baseline: ${baselinePath}`);
}

function resolveBaselineForEvalFile(evalFilePath: string): string {
  const absolutePath = path.resolve(evalFilePath);
  const baselinePath = absolutePath.replace(/\.ya?ml$/, '.baseline.jsonl');
  if (!existsSync(baselinePath)) {
    throw new Error(
      `Baseline file not found for eval file: ${evalFilePath}\nExpected: ${baselinePath}`,
    );
  }
  return baselinePath;
}

/** Generate candidate path as sibling to baseline */
function candidatePathFor(baselinePath: string): string {
  return baselinePath.replace(/\.baseline\.jsonl$/, '.candidate.jsonl');
}

async function runEval(evalFile: string, candidatePath: string): Promise<number> {
  const env = { ...process.env };
  if (!env.TOOL_EVAL_PLUGINS_DIR) {
    env.TOOL_EVAL_PLUGINS_DIR = path.join(
      repoRoot,
      'examples',
      'showcase',
      'tool-evaluation-plugins',
    );
  }

  const args = ['bun', 'agentv', 'eval', evalFile, '--out', candidatePath];
  const proc = Bun.spawn(args, {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
  return await proc.exited;
}

/** Read a JSONL file, trim each record for baseline storage, and write back. */
function trimBaselineFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  const trimmedLines = lines.map((line) => {
    const record = JSON.parse(line);
    const camel = toCamelCaseDeep(record) as EvaluationResult;
    const trimmed = trimBaselineResult(camel);
    const snake = toSnakeCaseDeep(trimmed);
    return JSON.stringify(snake);
  });

  writeFileSync(filePath, `${trimmedLines.join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun && !options.update) {
    console.error('--dry-run requires --update');
    process.exit(1);
  }

  let baselineFiles: string[];
  if (options.evalFile) {
    // Single eval file mode
    const baselinePath = resolveBaselineForEvalFile(options.evalFile);
    baselineFiles = [baselinePath];
  } else {
    // Default: find all baseline files under examples/
    baselineFiles = await findBaselineFiles(examplesRoot);
    if (baselineFiles.length === 0) {
      console.error('No baseline files found under examples/.');
      process.exit(1);
    }
  }

  let failures = 0;
  const updatedFiles: string[] = [];

  for (const baselinePath of baselineFiles.sort()) {
    const candidatePath = candidatePathFor(baselinePath);
    const evalFile = resolveEvalFile(baselinePath);
    const relativePath = path.relative(repoRoot, baselinePath);

    console.log(`Running eval for ${relativePath}`);
    const evalExitCode = await runEval(evalFile, candidatePath);
    if (evalExitCode !== 0) {
      failures += 1;
      continue;
    }

    if (!existsSync(candidatePath)) {
      console.error(`Missing candidate results for ${relativePath}`);
      failures += 1;
      continue;
    }

    if (options.update) {
      // Update mode: replace baseline with candidate
      if (options.dryRun) {
        console.log(`[dry-run] Would update: ${relativePath}`);
        updatedFiles.push(relativePath);
      } else {
        await rename(candidatePath, baselinePath);
        trimBaselineFile(baselinePath);
        console.log(`Updated (trimmed): ${relativePath}`);
        updatedFiles.push(relativePath);
      }
    } else {
      // Compare mode: check candidate against baseline
      const args = ['bun', 'agentv', 'compare', baselinePath, candidatePath];
      if (options.threshold) {
        args.push('--threshold', options.threshold);
      }

      console.log(`Comparing ${relativePath}`);
      const proc = Bun.spawn(args, {
        cwd: repoRoot,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        failures += 1;
      }
    }
  }

  if (options.update) {
    if (options.dryRun) {
      console.log(`\n[dry-run] Would update ${updatedFiles.length} baseline file(s).`);
    } else {
      console.log(`\nUpdated ${updatedFiles.length} baseline file(s).`);
    }
  } else {
    if (failures > 0) {
      console.error(`Baseline comparison failed for ${failures} file(s).`);
      process.exit(1);
    }
    console.log('Baseline comparison passed for all files.');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Baseline comparison failed: ${message}`);
  process.exit(1);
});
