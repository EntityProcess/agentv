import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

/** Supported eval file extensions: YAML, JSONL, and TypeScript/JavaScript */
const EVAL_FILE_RE = /\.(ya?ml|jsonl|ts|js|mts|mjs)$/i;

export async function resolveEvalPaths(evalPaths: string[], cwd: string): Promise<string[]> {
  const normalizedInputs = evalPaths.map((value) => value?.trim()).filter((value) => value);
  if (normalizedInputs.length === 0) {
    throw new Error('No eval paths provided.');
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
      if (stats.isFile() && EVAL_FILE_RE.test(candidatePath)) {
        results.add(candidatePath);
        continue;
      }
    } catch {
      // fall through to glob matching
    }

    const globPattern = pattern.includes('\\') ? pattern.replace(/\\/g, '/') : pattern;
    const matches = await fg(globPattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: true,
      followSymbolicLinks: true,
    });

    const evalMatches = matches.filter((filePath) => EVAL_FILE_RE.test(filePath));
    if (evalMatches.length === 0) {
      unmatched.push(pattern);
      continue;
    }

    for (const filePath of evalMatches) {
      results.add(path.normalize(filePath));
    }
  }

  if (unmatched.length > 0) {
    throw new Error(
      `No eval files matched: ${unmatched.join(
        ', ',
      )}. Provide YAML, JSONL, or TypeScript paths or globs (e.g., "evals/**/*.yaml", "evals/**/*.eval.ts").`,
    );
  }

  const sorted = Array.from(results);
  sorted.sort();
  return sorted;
}

export async function findRepoRoot(start: string): Promise<string> {
  const fallback = path.resolve(start);
  let current: string | undefined = fallback;

  while (current !== undefined) {
    const candidate = path.join(current, '.git');
    try {
      await access(candidate, constants.F_OK);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return fallback;
}
