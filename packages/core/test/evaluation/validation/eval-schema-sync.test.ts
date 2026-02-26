import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EvalFileSchema } from '../../../src/evaluation/validation/eval-file.schema.js';

describe('eval-schema.json sync', () => {
  it('matches the generated schema from Zod', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const schemaPath = path.join(
      repoRoot,
      'plugins/agentv-dev/skills/agentv-eval-builder/references/eval-schema.json',
    );

    // Read committed schema
    const committed = JSON.parse(await readFile(schemaPath, 'utf8'));

    // Generate fresh schema from Zod
    const generated = zodToJsonSchema(EvalFileSchema, {
      name: 'EvalFile',
      $refStrategy: 'none',
    });

    const expected = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'AgentV Eval File',
      description: 'Schema for AgentV evaluation YAML files (.eval.yaml)',
      ...generated,
    };

    // Compare (ignoring formatting differences)
    expect(JSON.parse(JSON.stringify(committed))).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});
