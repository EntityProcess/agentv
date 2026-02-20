#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { toCamelCaseDeep, toSnakeCaseDeep, trimBaselineResult } from '@agentv/core';
import type { EvaluationResult } from '@agentv/core';

type CliOptions = {
  threshold?: string;
  evalFile?: string;
  update: boolean;
  createMissing: boolean;
  dryRun: boolean;
};

const repoRoot = path.resolve(__dirname, '..');
const examplesRoot = path.join(repoRoot, 'examples');

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    update: false,
    createMissing: false,
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
    if (arg === '--create-missing') {
      options.createMissing = true;
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

/** Find dataset YAML files under examples/features/ (the convention for runnable evals) */
async function findDatasetYamlFiles(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findDatasetYamlFiles(fullPath, results);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.startsWith('dataset') &&
      (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveDatasetFile(baselinePath: string): string {
  const yamlPath = baselinePath.replace(/\.baseline\.jsonl$/, '.yaml');
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = baselinePath.replace(/\.baseline\.jsonl$/, '.yml');
  if (existsSync(ymlPath)) {
    return ymlPath;
  }
  throw new Error(`Dataset file not found for baseline: ${baselinePath}`);
}

function baselinePathFor(datasetFilePath: string): string {
  const absolutePath = path.resolve(datasetFilePath);
  return absolutePath.replace(/\.ya?ml$/, '.baseline.jsonl');
}

/** Generate candidate path as sibling to baseline */
function candidatePathFor(baselinePath: string): string {
  return baselinePath.replace(/\.baseline\.jsonl$/, '.candidate.jsonl');
}

async function runAgentVEval(datasetFile: string, candidatePath: string): Promise<number> {
  const env = { ...process.env };
  if (!env.TOOL_EVAL_PLUGINS_DIR) {
    env.TOOL_EVAL_PLUGINS_DIR = path.join(
      repoRoot,
      'examples',
      'showcase',
      'tool-evaluation-plugins',
    );
  }

  const args = ['bun', 'agentv', 'eval', datasetFile, '--out', candidatePath];
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

/** Clean up candidate files after comparison */
function cleanupCandidate(candidatePath: string): void {
  if (existsSync(candidatePath)) {
    unlinkSync(candidatePath);
  }
}

async function processDatasetFile(
  datasetFile: string,
  baselinePath: string,
  options: CliOptions,
): Promise<{ success: boolean; updated: boolean; created: boolean }> {
  const relativePath = path.relative(repoRoot, baselinePath);
  const candidatePath = candidatePathFor(baselinePath);
  const baselineExists = existsSync(baselinePath);

  console.log(`\nRunning: ${path.relative(repoRoot, datasetFile)}`);
  const exitCode = await runAgentVEval(datasetFile, candidatePath);
  if (exitCode !== 0) {
    cleanupCandidate(candidatePath);
    return { success: false, updated: false, created: false };
  }

  if (!existsSync(candidatePath)) {
    console.error(`Missing candidate results for ${relativePath}`);
    return { success: false, updated: false, created: false };
  }

  if (options.update) {
    if (options.dryRun) {
      const action = baselineExists ? 'update' : 'create';
      console.log(`[dry-run] Would ${action}: ${relativePath}`);
      cleanupCandidate(candidatePath);
      return { success: true, updated: baselineExists, created: !baselineExists };
    }
    await rename(candidatePath, baselinePath);
    trimBaselineFile(baselinePath);
    const action = baselineExists ? 'Updated' : 'Created';
    console.log(`${action} (trimmed): ${relativePath}`);
    return { success: true, updated: baselineExists, created: !baselineExists };
  }

  // Compare mode
  if (!baselineExists) {
    console.error(`No baseline to compare against: ${relativePath}`);
    console.error('  Run with --update to create it.');
    cleanupCandidate(candidatePath);
    return { success: false, updated: false, created: false };
  }

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
  const compareExitCode = await proc.exited;
  cleanupCandidate(candidatePath);
  return { success: compareExitCode === 0, updated: false, created: false };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun && !options.update) {
    console.error('--dry-run requires --update');
    process.exit(1);
  }

  if (options.createMissing && !options.update) {
    console.error('--create-missing requires --update');
    process.exit(1);
  }

  // Collect dataset file → baseline path pairs
  const pairs: Array<{ datasetFile: string; baselinePath: string }> = [];

  if (options.evalFile) {
    const absPath = path.resolve(options.evalFile);
    pairs.push({ datasetFile: absPath, baselinePath: baselinePathFor(absPath) });
  } else {
    // Find all existing baselines
    const baselineFiles = await findBaselineFiles(examplesRoot);
    for (const bp of baselineFiles) {
      try {
        const df = resolveDatasetFile(bp);
        pairs.push({ datasetFile: df, baselinePath: bp });
      } catch {
        console.warn(`Skipping orphaned baseline: ${path.relative(repoRoot, bp)}`);
      }
    }

    // Optionally discover dataset files without baselines
    if (options.createMissing) {
      const allDatasetFiles = await findDatasetYamlFiles(examplesRoot);
      const existingDatasetFiles = new Set(pairs.map((p) => p.datasetFile));

      for (const df of allDatasetFiles) {
        if (existingDatasetFiles.has(df)) continue;
        pairs.push({ datasetFile: df, baselinePath: baselinePathFor(df) });
      }
    }

    if (pairs.length === 0) {
      console.error('No baseline or dataset files found under examples/.');
      process.exit(1);
    }
  }

  let failures = 0;
  let updatedCount = 0;
  let createdCount = 0;

  for (const { datasetFile, baselinePath } of pairs.sort((a, b) =>
    a.datasetFile.localeCompare(b.datasetFile),
  )) {
    const result = await processDatasetFile(datasetFile, baselinePath, options);
    if (!result.success) failures += 1;
    if (result.updated) updatedCount += 1;
    if (result.created) createdCount += 1;
  }

  if (options.update) {
    const prefix = options.dryRun ? '[dry-run] Would have' : '';
    const parts: string[] = [];
    if (updatedCount > 0) parts.push(`updated ${updatedCount}`);
    if (createdCount > 0) parts.push(`created ${createdCount}`);
    if (parts.length > 0) {
      console.log(`\n${prefix} ${parts.join(', ')} baseline file(s).`);
    }
    if (failures > 0) {
      console.error(`${failures} dataset(s) failed.`);
      process.exit(1);
    }
  } else {
    if (failures > 0) {
      console.error(`\nBaseline comparison failed for ${failures} file(s).`);
      process.exit(1);
    }
    console.log('\nBaseline comparison passed for all files.');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Baseline check failed: ${message}`);
  process.exit(1);
});
