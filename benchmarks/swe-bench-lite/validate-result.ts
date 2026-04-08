#!/usr/bin/env bun
/**
 * Validate SWE-bench Lite result JSON files against the schema.
 *
 * Zero-dependency validator — uses runtime type checks instead of Zod
 * so it works standalone from the benchmarks/ directory.
 *
 * Usage:
 *   bun run validate-result.ts results/claude-opus-4.6.json
 *   bun run validate-result.ts results/*.json
 *
 * Used by CI to validate PR submissions.
 */

import { readFileSync } from 'node:fs';

const REQUIRED_TOP_FIELDS = [
  'model',
  'provider',
  'model_type',
  'date',
  'agent',
  'agent_version',
  'dataset',
  'total_instances',
  'resolved_instances',
  'resolution_rate',
  'avg_cost_usd',
  'avg_cost_per_fix_usd',
  'avg_duration_ms',
  'avg_tool_calls',
  'per_instance',
] as const;

const VALID_MODEL_TYPES = ['proprietary', 'open-source', 'open-weights'];

const REQUIRED_INSTANCE_FIELDS = [
  'instance_id',
  'resolved',
  'cost_usd',
  'duration_ms',
  'tool_calls',
] as const;

interface ValidationError {
  path: string;
  message: string;
}

function validateResult(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return [{ path: '', message: 'Root must be a JSON object' }];
  }

  const obj = data as Record<string, unknown>;

  // Check required fields exist
  for (const field of REQUIRED_TOP_FIELDS) {
    if (!(field in obj)) {
      errors.push({ path: field, message: 'Required field missing' });
    }
  }
  if (errors.length > 0) return errors;

  // Type checks
  if (typeof obj.model !== 'string') errors.push({ path: 'model', message: 'Must be a string' });
  if (typeof obj.provider !== 'string')
    errors.push({ path: 'provider', message: 'Must be a string' });
  if (!VALID_MODEL_TYPES.includes(obj.model_type as string))
    errors.push({ path: 'model_type', message: `Must be one of: ${VALID_MODEL_TYPES.join(', ')}` });
  if (typeof obj.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date as string))
    errors.push({ path: 'date', message: 'Must be YYYY-MM-DD format' });
  if (typeof obj.agent !== 'string') errors.push({ path: 'agent', message: 'Must be a string' });
  if (typeof obj.agent_version !== 'string')
    errors.push({ path: 'agent_version', message: 'Must be a string' });
  if (obj.dataset !== 'swe-bench-lite')
    errors.push({ path: 'dataset', message: 'Must be "swe-bench-lite"' });

  const numFields = [
    'total_instances',
    'resolved_instances',
    'resolution_rate',
    'avg_cost_usd',
    'avg_cost_per_fix_usd',
    'avg_duration_ms',
    'avg_tool_calls',
  ];
  for (const f of numFields) {
    if (typeof obj[f] !== 'number' || Number.isNaN(obj[f] as number))
      errors.push({ path: f, message: 'Must be a number' });
  }

  if (
    typeof obj.resolution_rate === 'number' &&
    ((obj.resolution_rate as number) < 0 || (obj.resolution_rate as number) > 1)
  )
    errors.push({ path: 'resolution_rate', message: 'Must be between 0 and 1' });

  // Validate per_instance array
  if (!Array.isArray(obj.per_instance)) {
    errors.push({ path: 'per_instance', message: 'Must be an array' });
  } else {
    for (let i = 0; i < obj.per_instance.length; i++) {
      const inst = obj.per_instance[i] as Record<string, unknown>;
      for (const field of REQUIRED_INSTANCE_FIELDS) {
        if (!(field in inst)) {
          errors.push({ path: `per_instance[${i}].${field}`, message: 'Required field missing' });
        }
      }
      if (typeof inst.instance_id !== 'string')
        errors.push({ path: `per_instance[${i}].instance_id`, message: 'Must be a string' });
      if (typeof inst.resolved !== 'boolean')
        errors.push({ path: `per_instance[${i}].resolved`, message: 'Must be a boolean' });
    }
  }

  return errors;
}

// CLI entry point
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: bun run validate-result.ts <result-file.json> [...]');
  process.exit(1);
}

let hasErrors = false;

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf8');
    const data = JSON.parse(content) as Record<string, unknown>;
    const errors = validateResult(data);

    if (errors.length > 0) {
      console.error(`❌ ${file}:`);
      for (const err of errors) {
        console.error(`   ${err.path}: ${err.message}`);
      }
      hasErrors = true;
    } else {
      // Cross-validate computed fields
      const totalInstances = data.total_instances as number;
      const resolvedInstances = data.resolved_instances as number;
      const resolutionRate = data.resolution_rate as number;
      const perInstance = data.per_instance as unknown[];

      const expectedRate = totalInstances > 0 ? resolvedInstances / totalInstances : 0;
      if (Math.abs(resolutionRate - expectedRate) > 0.01) {
        console.error(
          `❌ ${file}: resolution_rate ${resolutionRate} doesn't match resolved/total (${expectedRate.toFixed(3)})`,
        );
        hasErrors = true;
      } else if (perInstance.length !== totalInstances) {
        console.warn(
          `⚠️  ${file}: per_instance has ${perInstance.length} entries but total_instances is ${totalInstances} (partial results)`,
        );
        console.log(`✅ ${file} — ${data.model} (${resolutionRate * 100}% resolved, partial)`);
      } else {
        console.log(`✅ ${file} — ${data.model} (${resolutionRate * 100}% resolved)`);
      }
    }
  } catch (err) {
    console.error(`❌ ${file}: ${err instanceof Error ? err.message : String(err)}`);
    hasErrors = true;
  }
}

process.exit(hasErrors ? 1 : 0);
