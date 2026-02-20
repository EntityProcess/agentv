import { z } from 'zod';
import type { JsonObject } from './types.js';

const MetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
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
  const hasName = typeof suite.name === 'string';
  const hasDescription = typeof suite.description === 'string';

  // Only trigger metadata parsing when `name` is present.
  // `description` alone doesn't trigger it since it's also used as a regular suite field.
  if (!hasName) {
    return undefined;
  }

  return MetadataSchema.parse({
    name: suite.name,
    description: suite.description,
    version: suite.version,
    author: suite.author,
    tags: suite.tags,
    license: suite.license,
    requires: suite.requires,
  });
}
