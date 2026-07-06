import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { isTypeScriptEvalConfigFileName, typeScriptEvalConfigGlob } from '@agentv/core';
import fg from 'fast-glob';

import { isAgentSkillsEvalsJsonFile } from '../read-adapters/agent-skills-evals.js';

export interface ResolveEvalPathOptions {
  readonly allowReadAdapters?: boolean;
}

function isNativeEvalFile(filePath: string): boolean {
  return /\.(ya?ml|jsonl)$/i.test(filePath) || isTypeScriptEvalConfigFileName(filePath);
}

function shouldInspectJsonPath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === 'evals.json' || base.endsWith('.evals.json');
}

function jsonEvalPathError(pattern: string): Error {
  return new Error(
    `Unsupported .json eval file: ${pattern}. Agent Skills evals.json read adapters require top-level 'skill_name' and 'evals'. Use YAML, JSONL, TypeScript, or run 'agentv convert ${pattern} --out EVAL.yaml'.`,
  );
}

export async function resolveEvalPaths(
  evalPaths: string[],
  cwd: string,
  options: ResolveEvalPathOptions = {},
): Promise<string[]> {
  const normalizedInputs = evalPaths.map((value) => value?.trim()).filter((value) => value);
  if (normalizedInputs.length === 0) {
    throw new Error('No eval paths provided.');
  }

  // Separate negation patterns (!glob) from include patterns.
  // Negation patterns are passed to fast-glob as `ignore`.
  const includePatterns: string[] = [];
  const ignorePatterns: string[] = [];
  for (const input of normalizedInputs) {
    if (input.startsWith('!')) {
      ignorePatterns.push(input.slice(1));
    } else {
      includePatterns.push(input);
    }
  }

  if (includePatterns.length === 0) {
    throw new Error('No eval paths provided (only negation patterns found).');
  }

  const results = new Set<string>();

  for (const pattern of includePatterns) {
    // If the pattern points to an existing file or directory, short-circuit globbing
    const candidatePath = path.isAbsolute(pattern)
      ? path.normalize(pattern)
      : path.resolve(cwd, pattern);
    let candidateStats: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      candidateStats = await stat(candidatePath);
    } catch {
      candidateStats = undefined;
    }

    if (candidateStats) {
      if (candidateStats.isFile() && path.extname(candidatePath).toLowerCase() === '.json') {
        if (options.allowReadAdapters && isAgentSkillsEvalsJsonFile(candidatePath)) {
          results.add(candidatePath);
          continue;
        }
        throw jsonEvalPathError(pattern);
      }
      if (candidateStats.isFile() && isNativeEvalFile(candidatePath)) {
        results.add(candidatePath);
        continue;
      }
      if (candidateStats.isDirectory()) {
        // Auto-expand directory to recursive eval file glob
        const filePattern = options.allowReadAdapters
          ? `{suite.yaml,suite.yml,*.eval.yaml,*.eval.yml,eval.yaml,eval.yml,${typeScriptEvalConfigGlob()},evals.json,*.evals.json}`
          : `{suite.yaml,suite.yml,*.eval.yaml,*.eval.yml,eval.yaml,eval.yml,${typeScriptEvalConfigGlob()}}`;
        const dirGlob = path.posix.join(candidatePath.replace(/\\/g, '/'), `**/${filePattern}`);
        const dirMatches = await fg(dirGlob, {
          absolute: true,
          onlyFiles: true,
          unique: true,
          dot: true,
          followSymbolicLinks: true,
          ignore: ignorePatterns,
        });
        for (const filePath of dirMatches) {
          results.add(path.normalize(filePath));
        }
        continue;
      }
    }

    const globPattern = pattern.includes('\\') ? pattern.replace(/\\/g, '/') : pattern;
    const matches = await fg(globPattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: true,
      followSymbolicLinks: true,
      ignore: ignorePatterns,
    });

    const supportedMatches = matches.filter((filePath) => {
      if (isNativeEvalFile(filePath)) {
        return true;
      }
      return (
        options.allowReadAdapters &&
        path.extname(filePath).toLowerCase() === '.json' &&
        shouldInspectJsonPath(filePath) &&
        isAgentSkillsEvalsJsonFile(filePath)
      );
    });
    for (const filePath of supportedMatches) {
      results.add(path.normalize(filePath));
    }
  }

  if (ignorePatterns.length > 0 && results.size > 0) {
    const ignoredMatches = await fg(ignorePatterns, {
      cwd,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: true,
      followSymbolicLinks: true,
    });

    for (const filePath of ignoredMatches) {
      results.delete(path.normalize(filePath));
    }
  }

  if (results.size === 0) {
    throw new Error(
      `No eval files matched any provided paths or globs: ${includePatterns.join(
        ', ',
      )}. Provide YAML, JSONL, TypeScript, or supported read-adapter paths/globs (e.g., "evals/**/suite.yaml", "evals/**/*.eval.ts", "skills/**/evals.json").`,
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
