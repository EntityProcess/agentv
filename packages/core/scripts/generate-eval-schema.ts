#!/usr/bin/env bun
import { spawn } from 'node:child_process';
/**
 * Generates AgentV JSON schemas from Zod schemas.
 * Run: bun run generate:schema (from packages/core)
 * Or:  bun packages/core/scripts/generate-eval-schema.ts (from repo root)
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EvalFileSchema } from '../src/evaluation/validation/eval-file.schema.js';

async function formatWithBiome(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['x', 'biome', 'format', '--write', filePath], {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Biome exited with code ${code}`));
    });
  });
}

async function writeSchema(options: {
  readonly schema: Parameters<typeof zodToJsonSchema>[0];
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly outputFile: string;
}): Promise<void> {
  const jsonSchema = zodToJsonSchema(options.schema, {
    name: options.name,
    $refStrategy: 'none',
    target: 'jsonSchema2019-09',
  });

  const schema = {
    $schema: 'https://json-schema.org/draft/2019-09/schema',
    title: options.title,
    description: options.description,
    ...jsonSchema,
  };

  const outputPath = path.resolve(
    import.meta.dirname,
    '../../../skills-data/agentv-eval-writer/references',
    options.outputFile,
  );

  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
  await formatWithBiome(outputPath);
  console.log(`Generated: ${outputPath}`);
}

await writeSchema({
  schema: EvalFileSchema,
  name: 'EvalFile',
  title: 'AgentV Eval File',
  description: 'Schema for AgentV evaluation YAML files (.eval.yaml)',
  outputFile: 'eval.schema.json',
});
