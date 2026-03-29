import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

export async function resolveEvalPaths(evalPaths: string[], cwd: string): Promise<string[]> {
  const normalizedInputs = evalPaths.map((value) => value?.trim()).filter((value) => value);
  if (normalizedInputs.length === 0) {
    throw new Error('No eval paths provided.');
  }

  const unmatched: string[] = [];
  const results = new Set<string>();

  for (const pattern of normalizedInputs) {
    // If the pattern points to an existing file or directory, short-circuit globbing
    const candidatePath = path.isAbsolute(pattern)
      ? path.normalize(pattern)
      : path.resolve(cwd, pattern);
    try {
      const stats = await stat(candidatePath);
      if (stats.isFile() && /\.(ya?ml|jsonl|json)$/i.test(candidatePath)) {
        results.add(candidatePath);
        continue;
      }
      if (stats.isDirectory()) {
        // Auto-expand directory to recursive eval file glob
        const dirGlob = path.posix.join(
          candidatePath.replace(/\\/g, '/'),
          '**/*.eval.{yaml,yml}',
        );
        const dirMatches = await fg(dirGlob, {
          absolute: true,
          onlyFiles: true,
          unique: true,
          dot: true,
          followSymbolicLinks: true,
        });
        if (dirMatches.length === 0) {
          unmatched.push(pattern);
        } else {
          for (const filePath of dirMatches) {
            results.add(path.normalize(filePath));
          }
        }
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

    const yamlMatches = matches.filter((filePath) => /\.(ya?ml|jsonl|json)$/i.test(filePath));
    if (yamlMatches.length === 0) {
      unmatched.push(pattern);
      continue;
    }

    for (const filePath of yamlMatches) {
      results.add(path.normalize(filePath));
    }
  }

  if (unmatched.length > 0) {
    throw new Error(
      `No eval files matched: ${unmatched.join(
        ', ',
      )}. Provide YAML, JSONL, or JSON paths or globs (e.g., "evals/**/*.yaml", "evals/**/*.jsonl", "evals.json").`,
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
