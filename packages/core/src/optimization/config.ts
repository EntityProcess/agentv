import path from "node:path";
import { readFile } from "node:fs/promises";

import { z } from "zod";
import { parse } from "yaml";

/**
 * Raw optimizer configuration as authored by users.
 */
export const optimizerConfigSchema = z.object({
  description: z.string().optional(),
  type: z.literal("ace"),
  eval_files: z.array(z.string().min(1)).nonempty("At least one eval file is required"),
  playbook_path: z.string().min(1, "playbook_path is required"),
  max_epochs: z.number().int().positive("max_epochs must be a positive integer"),
  allow_dynamic_sections: z.boolean().optional().default(false),
});

export type OptimizerConfig = z.infer<typeof optimizerConfigSchema>;

export interface ResolvedOptimizerConfig {
  readonly description?: string;
  readonly type: "ace";
  readonly evalFiles: readonly string[];
  readonly playbookPath: string;
  readonly maxEpochs: number;
  readonly allowDynamicSections: boolean;
}

export function parseOptimizerConfig(input: unknown, baseDir: string): ResolvedOptimizerConfig {
  const parsed = optimizerConfigSchema.parse(input);
  const resolve = (value: string): string => {
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
  };

  const seen = new Set<string>();
  const evalFiles: string[] = [];
  for (const file of parsed.eval_files) {
    const resolved = resolve(file);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      evalFiles.push(resolved);
    }
  }

  return {
    description: parsed.description,
    type: "ace",
    evalFiles,
    playbookPath: resolve(parsed.playbook_path),
    maxEpochs: parsed.max_epochs,
    allowDynamicSections: parsed.allow_dynamic_sections ?? false,
  };
}

export async function loadOptimizerConfig(configPath: string): Promise<ResolvedOptimizerConfig> {
  const resolvedPath = path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.resolve(configPath);

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = parse(raw) as unknown;
  return parseOptimizerConfig(parsed, path.dirname(resolvedPath));
}
