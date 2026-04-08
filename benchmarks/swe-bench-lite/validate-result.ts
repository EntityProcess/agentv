#!/usr/bin/env bun
/**
 * Validate SWE-bench Lite result JSON files against the schema.
 *
 * Usage:
 *   bun run validate-result.ts results/claude-opus-4.6.json
 *   bun run validate-result.ts results/*.json
 *
 * Used by CI to validate PR submissions.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const PerInstanceSchema = z
  .object({
    instance_id: z.string(),
    resolved: z.boolean(),
    cost_usd: z.number().min(0),
    duration_ms: z.number().min(0),
    tool_calls: z.number().int().min(0),
  })
  .strict();

const ResultSchema = z
  .object({
    model: z.string(),
    provider: z.string(),
    model_type: z.enum(['proprietary', 'open-source', 'open-weights']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    agent: z.string(),
    agent_version: z.string(),
    dataset: z.literal('swe-bench-lite'),
    total_instances: z.number().int().min(1),
    resolved_instances: z.number().int().min(0),
    resolution_rate: z.number().min(0).max(1),
    avg_cost_usd: z.number().min(0),
    avg_cost_per_fix_usd: z.number().min(0),
    avg_duration_ms: z.number().min(0),
    avg_tool_calls: z.number().min(0),
    per_instance: z.array(PerInstanceSchema),
  })
  .strict();

export { ResultSchema, PerInstanceSchema };

// CLI entry point
if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: bun run validate-result.ts <result-file.json> [...]');
    process.exit(1);
  }

  let hasErrors = false;

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const data = JSON.parse(content);
      const result = ResultSchema.safeParse(data);

      if (!result.success) {
        console.error(`❌ ${file}:`);
        for (const issue of result.error.issues) {
          console.error(`   ${issue.path.join('.')}: ${issue.message}`);
        }
        hasErrors = true;
      } else {
        // Cross-validate computed fields
        const d = result.data;
        const expectedRate = d.total_instances > 0 ? d.resolved_instances / d.total_instances : 0;
        if (Math.abs(d.resolution_rate - expectedRate) > 0.01) {
          console.error(
            `❌ ${file}: resolution_rate ${d.resolution_rate} doesn't match resolved/total (${expectedRate.toFixed(3)})`,
          );
          hasErrors = true;
        } else if (d.per_instance.length !== d.total_instances) {
          console.error(
            `❌ ${file}: per_instance has ${d.per_instance.length} entries but total_instances is ${d.total_instances}`,
          );
          hasErrors = true;
        } else {
          console.log(`✅ ${file} — ${d.model} (${d.resolution_rate * 100}% resolved)`);
        }
      }
    } catch (err) {
      console.error(`❌ ${file}: ${err instanceof Error ? err.message : String(err)}`);
      hasErrors = true;
    }
  }

  process.exit(hasErrors ? 1 : 0);
}
