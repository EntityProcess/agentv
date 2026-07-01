import { z } from 'zod';
import type { JsonObject } from './types.js';

const MetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().min(1).max(1024).optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  license: z.string().optional(),
  requires: z
    .object({
      agentv: z.string().optional(),
    })
    .optional(),
});

export type EvalMetadata = z.infer<typeof MetadataSchema>;

export function parseMetadata(suite: JsonObject): EvalMetadata | undefined {
  if (typeof suite.name !== 'string') {
    return undefined;
  }

  return MetadataSchema.parse({
    name: suite.name,
    description: suite.description,
    version: suite.version,
    author: suite.author,
    // `tags` may be authored as a promptfoo-shaped `Record<string,string>` map
    // (carried separately as run metadata via EvalSuiteResult.tags). Only the
    // list form drives selection metadata here; the map form is ignored.
    tags: Array.isArray(suite.tags) ? suite.tags : undefined,
    license: suite.license,
    requires: suite.requires,
  });
}
