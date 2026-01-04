#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

type CliOptions = {
  candidateRoot: string;
  threshold?: string;
};

const repoRoot = path.resolve(__dirname, '..');
const examplesRoot = path.join(repoRoot, 'examples');

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    candidateRoot: path.join(repoRoot, '.agentv', 'candidate-results'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--candidate-root') {
      options.candidateRoot = argv[i + 1] ?? options.candidateRoot;
      i += 1;
      continue;
    }
    if (arg === '--threshold') {
      options.threshold = argv[i + 1];
      i += 1;
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

function candidatePathFor(
  baselinePath: string,
  candidateRoot: string,
): { candidatePath: string; relativePath: string } {
  const relativePath = path.relative(repoRoot, baselinePath);
  const candidatePath = path
    .join(candidateRoot, relativePath)
    .replace(/\.baseline\.jsonl$/, '.candidate.jsonl');
  return { candidatePath, relativePath };
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (existsSync(dir)) {
    return;
  }
  await mkdir(dir, { recursive: true });
}

async function runEval(evalFile: string, candidatePath: string): Promise<number> {
  await ensureParentDir(candidatePath);

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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baselineFiles = await findBaselineFiles(examplesRoot);

  if (baselineFiles.length === 0) {
    console.error('No baseline files found under examples/.');
    process.exit(1);
  }

  const skipEvalFiles = new Set<string>();
  if (process.env.CI) {
    skipEvalFiles.add(
      path.join(
        repoRoot,
        'examples',
        'showcase',
        'psychotherapy',
        'evals',
        'dataset-encouragement.yaml',
      ),
    );
  }

  let failures = 0;

  for (const baselinePath of baselineFiles.sort()) {
    const { candidatePath, relativePath } = candidatePathFor(baselinePath, options.candidateRoot);
    const evalFile = resolveEvalFile(baselinePath);

    if (skipEvalFiles.has(evalFile)) {
      console.log(`Skipping eval in CI for ${relativePath}`);
      continue;
    }

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

  if (failures > 0) {
    console.error(`Baseline comparison failed for ${failures} file(s).`);
    process.exit(1);
  }

  console.log('Baseline comparison passed for all files.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Baseline comparison failed: ${message}`);
  process.exit(1);
});
