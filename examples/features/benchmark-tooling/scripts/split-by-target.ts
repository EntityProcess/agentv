#!/usr/bin/env bun
/**
 * split-by-target — Split a combined results JSONL file into one file per target.
 *
 * Usage:
 *   bun examples/features/benchmark-tooling/scripts/split-by-target.ts <input.jsonl> [output-dir]
 *
 * Output directory defaults to the same directory as the input file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

function normalizeTargetName(target: string): string {
  return target
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // replace unsafe chars with hyphens
    .replace(/-+/g, '-') // collapse consecutive hyphens
    .replace(/^-|-$/g, ''); // strip leading/trailing hyphens
}

function splitByTarget(inputPath: string, outputDir: string): void {
  const content = readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    console.error('Error: input file is empty or contains no valid lines.');
    process.exit(1);
  }

  const groups = new Map<string, string[]>();

  for (const line of lines) {
    let record: { target?: string };
    try {
      record = JSON.parse(line);
    } catch {
      console.error(`Warning: skipping non-JSON line: ${line.slice(0, 80)}`);
      continue;
    }

    const target = record.target ?? 'unknown';
    if (!groups.has(target)) {
      groups.set(target, []);
    }
    groups.get(target)?.push(line);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const inputBase = basename(inputPath, '.jsonl');

  for (const [target, records] of groups) {
    const safeName = normalizeTargetName(target) || 'unknown';
    const outFile = resolve(outputDir, `${inputBase}.${safeName}.jsonl`);
    writeFileSync(outFile, `${records.join('\n')}\n`);
    console.log(`  ${outFile} (${records.length} records)`);
  }

  console.log(`\nSplit ${lines.length} records into ${groups.size} target file(s).`);
}

// --- CLI entry point ---

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: bun split-by-target.ts <input.jsonl> [output-dir]\n\nSplits a combined results JSONL into one file per target.',
  );
  process.exit(0);
}

const inputPath = resolve(args[0]);
const outputDir = args[1] ? resolve(args[1]) : dirname(inputPath);

if (!existsSync(inputPath)) {
  console.error(`Error: input file not found: ${inputPath}`);
  process.exit(1);
}

console.log(`Splitting ${inputPath} by target → ${outputDir}\n`);
splitByTarget(inputPath, outputDir);
