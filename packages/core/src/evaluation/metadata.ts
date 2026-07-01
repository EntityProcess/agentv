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

/**
 * Resolve suite `tags` for selection metadata. `tags` may be authored as the
 * existing string list (selection) or a promptfoo-shaped `Record<string,string>`
 * map (run metadata carried separately via EvalSuiteResult.tags). The list form
 * is validated by the schema here; the map form is intentionally not selection
 * metadata and returns undefined. Any other shape (scalar/number) is rejected
 * loudly rather than silently dropped.
 */
function selectionTagsForMetadata(tags: unknown): unknown {
  if (tags === undefined) {
    return undefined;
  }
  if (Array.isArray(tags)) {
    return tags;
  }
  if (typeof tags === 'object' && tags !== null) {
    return undefined;
  }
  throw new Error('Invalid `tags`: expected a list of strings or a key=value map of strings.');
}

export function parseMetadata(suite: JsonObject): EvalMetadata | undefined {
  if (typeof suite.name !== 'string') {
    return undefined;
  }

  return MetadataSchema.parse({
    name: suite.name,
    description: suite.description,
    version: suite.version,
    author: suite.author,
    tags: selectionTagsForMetadata(suite.tags),
    license: suite.license,
    requires: suite.requires,
  });
}
