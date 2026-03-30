#!/usr/bin/env bun
/**
 * Validates that each feature directory under examples/features/ that has an
 * evals/ subdirectory contains at least one *.eval.yaml or *.EVAL.yaml file
 * (either inside evals/ or at the feature root).
 *
 * Directories without an evals/ subdirectory are skipped — they may be SDK
 * examples or other non-eval feature demos.
 *
 * Usage:
 *   bun scripts/validate-eval-dirs.ts
 */

import { globSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const featuresDir = resolve(root, 'examples/features');

// Feature dirs whose evals/ folder intentionally holds only support files
// (result JSONL, baselines) rather than eval definitions. Remove entries here
// once they gain proper eval YAML files.
const KNOWN_EXCEPTIONS = new Set([
  'compare', // evals/ holds baseline/candidate result JSONL for agentv compare
  'trace-analysis', // evals/ holds pre-recorded trace results
]);

const errors: string[] = [];
const entries = readdirSync(featuresDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

  const featureDir = join(featuresDir, entry.name);
  const evalsDir = join(featureDir, 'evals');

  // Only check features that have an evals/ subdirectory
  try {
    if (!statSync(evalsDir).isDirectory()) continue;
  } catch {
    continue;
  }

  // Look for eval files in evals/ (recursive) and at feature root.
  // Matches: *.eval.yaml, *.EVAL.yaml, eval.yaml, dataset*.yaml (config default patterns)
  const evalPatterns = [
    '**/*.{eval.yaml,eval.yml,EVAL.yaml,EVAL.yml}',
    '**/eval.{yaml,yml}',
    '**/dataset*.{yaml,yml}',
  ];
  const evalFilesInEvalsDir = evalPatterns.flatMap((p) => globSync(p, { cwd: evalsDir }));
  const evalFilesAtRoot = evalPatterns.flatMap((p) =>
    globSync(p.replace('**/', ''), { cwd: featureDir }),
  );

  if (evalFilesInEvalsDir.length === 0 && evalFilesAtRoot.length === 0) {
    if (KNOWN_EXCEPTIONS.has(entry.name)) {
      console.warn(`WARN: ${relative(root, evalsDir)} has no eval files (known exception)`);
    } else {
      errors.push(relative(root, evalsDir));
    }
  }
}

if (errors.length > 0) {
  console.error(
    'The following evals/ directories contain no eval files (*.eval.yaml or *.EVAL.yaml):',
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const checked = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
console.log(`OK: ${checked} feature directories checked`);
