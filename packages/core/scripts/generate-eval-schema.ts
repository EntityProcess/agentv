#!/usr/bin/env bun
/**
 * Generates eval-schema.json from the Zod schema.
 * Run: bun run generate:schema (from packages/core)
 * Or:  bun packages/core/scripts/generate-eval-schema.ts (from repo root)
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EvalFileSchema } from '../src/evaluation/validation/eval-file.schema.js';

const jsonSchema = zodToJsonSchema(EvalFileSchema, {
  name: 'EvalFile',
  $refStrategy: 'none',
});

// Add JSON Schema metadata
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AgentV Eval File',
  description: 'Schema for AgentV evaluation YAML files (.eval.yaml)',
  ...jsonSchema,
};

const outputPath = path.resolve(
  import.meta.dirname,
  '../../../plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json',
);

await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Generated: ${outputPath}`);
