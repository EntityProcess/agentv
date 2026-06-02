import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { relativePosix } from './path.js';
import type { AgentVSource } from './types.js';

const EVAL_FILE_RE = /\.(?:eval|EVAL)\.ya?ml$/;

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results);
      continue;
    }
    if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

export async function discoverAgentVEvals(agentvRoot: string): Promise<AgentVSource[]> {
  const examplesRoot = path.join(agentvRoot, 'examples');
  const files = await walk(examplesRoot);

  return files
    .filter(
      (file) => EVAL_FILE_RE.test(path.basename(file)) || path.basename(file) === 'evals.json',
    )
    .map((file): AgentVSource => {
      const relativePath = relativePosix(agentvRoot, file);
      return {
        path: file,
        relativePath,
        kind: path.basename(file) === 'evals.json' ? 'agent-skills-json' : 'eval-yaml',
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
