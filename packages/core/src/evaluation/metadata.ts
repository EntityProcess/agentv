import { z } from 'zod';
import type { JsonObject } from './types.js';

/**
 * Optional governance block on suite-level `EvalMetadata` and case-level `EvalTest.metadata`.
 *
 * The schema is intentionally permissive: every field is optional, unknown fields pass through,
 * and value validation is delegated to a soft-warning lint in `eval-validator.ts`. The block
 * captures convergence on public AI-governance taxonomies (NIST AI RMF, ISO/IEC 42001, EU AI Act,
 * OWASP LLM Top 10, MITRE ATLAS) without prescribing a workflow or hard-coding ID lists.
 *
 * Versioning lives in field names (`owasp_llm_top_10_2025`) so that when a standard revises and
 * redefines IDs (OWASP LLM Top 10 v2025 vs v1.1), agentv ships a new field rather than
 * silently changing the meaning of existing tags.
 *
 * To extend with a new versioned taxonomy: add an optional `string[]` field here, document it in
 * the README under examples/red-team/, and propagate through the `agentv eval` JSONL output.
 */
const GovernanceMetadataSchema = z
  .object({
    /** Schema version of this governance block itself (lets the block evolve). */
    schema_version: z.string().optional(),
    /** OWASP LLM Top 10 v2025 IDs (LLM01..LLM10). */
    owasp_llm_top_10_2025: z.array(z.string()).optional(),
    /** OWASP Top 10 for Agentic Applications v2025 (T1..T10). */
    owasp_agentic_top_10_2025: z.array(z.string()).optional(),
    /** MITRE ATLAS technique IDs (e.g. AML.T0051, AML.T0075). */
    mitre_atlas: z.array(z.string()).optional(),
    /**
     * Cross-framework controls. String format: `<FRAMEWORK>-<VERSION>:<ID>`.
     * Custom prefixes are first-class (e.g. `INTERNAL-AI-POLICY-3.2:CTRL-7`).
     */
    controls: z.array(z.string()).optional(),
    /**
     * Risk vocabulary anchored to EU AI Act terminology by default.
     * Allowed values: `prohibited | high | limited | minimal`.
     * Other strings (e.g. NIST 800-30 `low | moderate | high`) are accepted with a soft warning.
     */
    risk_tier: z.string().optional(),
    /** Human-readable owner (team name, group). */
    owner: z.string().optional(),
  })
  .passthrough();

export type GovernanceMetadata = z.infer<typeof GovernanceMetadataSchema>;

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
  governance: GovernanceMetadataSchema.optional(),
});

export type EvalMetadata = z.infer<typeof MetadataSchema>;

/**
 * Extract the governance block from a suite-level YAML. Accepts either:
 *   - top-level `governance:` (consistent with `description`, `tags`, etc.)
 *   - nested `metadata.governance:` (matches the case-level shape)
 * Top-level wins if both are present.
 */
function extractGovernance(suite: JsonObject): unknown {
  if (suite.governance !== undefined) {
    return suite.governance;
  }
  const wrapper = suite.metadata;
  if (wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)) {
    return (wrapper as Record<string, unknown>).governance;
  }
  return undefined;
}

export function parseMetadata(suite: JsonObject): EvalMetadata | undefined {
  const hasName = typeof suite.name === 'string';
  const governanceRaw = extractGovernance(suite);

  // Trigger metadata parsing when `name` is present, OR when a governance block exists
  // (so authors can attach governance to suites that don't have a name).
  if (!hasName && governanceRaw === undefined) {
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
    governance: governanceRaw,
  });
}
