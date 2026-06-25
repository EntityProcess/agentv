/**
 * Zod schema for experiment YAML file format.
 * Used to generate experiment-schema.json for AI agent reference.
 *
 * IMPORTANT: This schema describes the YAML input format, not the parsed runtime types.
 * Wire fields are snake_case. The only camelCase field accepted here is
 * repeat.costLimitUsd, kept for parity with the prerelease trials schema.
 */
import { z } from 'zod';

const JsonObjectSchema = z.object({}).catchall(z.unknown());

const StringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const ExperimentScriptSchema = z.union([
  z.string().min(1),
  z
    .object({
      command: StringOrStringArraySchema.optional(),
      script: StringOrStringArraySchema.optional(),
      timeout_seconds: z.number().gt(0).optional(),
      cwd: z.string().min(1).optional(),
      env: z.record(z.string()).optional(),
    })
    .strict()
    .refine((value) => value.command !== undefined || value.script !== undefined, {
      message: 'Experiment step must define command or script.',
    }),
]);

const ExperimentRepeatSchema = z
  .object({
    count: z.number().int().min(1),
    strategy: z.enum(['pass_at_k', 'mean', 'confidence_interval']).optional(),
    cost_limit_usd: z.number().min(0).optional(),
    costLimitUsd: z.number().min(0).optional(),
  })
  .strict();

const ExperimentTargetRefSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      use_target: z.string().min(1).optional(),
      hooks: JsonObjectSchema.optional(),
    })
    .strict(),
]);

const ExperimentSuiteSelectSchema = z
  .object({
    test_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ExperimentSuiteRefSchema = z
  .object({
    ref: z.string().min(1),
    select: ExperimentSuiteSelectSchema.optional(),
  })
  .strict();

export const ExperimentFileSchema = z
  .object({
    name: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    targets: z.array(ExperimentTargetRefSchema).min(1).optional(),
    model: z.string().min(1).optional(),
    agent_options: JsonObjectSchema.optional(),
    suites: z.array(ExperimentSuiteRefSchema).min(1).optional(),
    scripts: z.array(ExperimentScriptSchema).optional(),
    repeat: ExperimentRepeatSchema.optional(),
    runs: z.number().int().min(1).optional(),
    early_exit: z.boolean().optional(),
    timeout_seconds: z.number().gt(0).optional(),
    workers: z.number().int().min(1).optional(),
    budget_usd: z.number().gt(0).optional(),
    sandbox: z.enum(['auto', 'docker', 'vercel']).optional(),
    workspace: JsonObjectSchema.optional(),
    setup: z.array(ExperimentScriptSchema).optional(),
  })
  .strict()
  .refine((value) => value.repeat === undefined || value.runs === undefined, {
    message: 'Use repeat or runs, not both.',
  });
