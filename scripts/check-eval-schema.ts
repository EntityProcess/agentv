#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const schemaPath = 'skills-data/agentv-eval-writer/references/eval.schema.json';
const schemaAbsolutePath = path.join(repoRoot, schemaPath);

async function runOrExit(args: string[], options: { readonly cwd: string }): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function printSchemaDiff(): Promise<void> {
  await runOrExit(['git', 'diff', '--', schemaPath], { cwd: repoRoot });
}

async function readSchema(): Promise<string | null> {
  try {
    return await readFile(schemaAbsolutePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

const before = await readSchema();
await runOrExit([process.execPath, 'packages/core/scripts/generate-eval-schema.ts'], {
  cwd: repoRoot,
});
const after = await readSchema();

if (before === after) {
  console.log(`OK: ${schemaPath} is generated from the Zod source`);
  process.exit(0);
}

const message =
  'Generated eval schema is out of sync. This command regenerated eval.schema.json from packages/core/src/evaluation/validation/eval-file.schema.ts; review and commit the generated diff instead of editing the JSON manually.';
if (process.env.GITHUB_ACTIONS === 'true') {
  console.error(`::error file=${schemaPath}::${message}`);
}
console.error(`[schema] ERROR: ${message}`);
console.error('  Run locally: bun run validate:eval-schema');
console.error(`  Generated file: ${schemaPath}`);
await printSchemaDiff();
process.exit(1);
