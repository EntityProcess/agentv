/**
 * Regression test: YAML merge keys (`<<: *anchor`) are unwrapped at the parse
 * boundary so the literal `<<` key never reaches downstream consumers.
 *
 * Bug history: PR #1166's red-team eval used `governance: { <<: *gov, ... }`.
 * Because the `yaml` package leaves `<<` as a literal key in YAML 1.2 mode,
 * `<<` leaked into JSONL `metadata.governance`. The fix funnels all parses
 * through `parseYamlValue`, which sets `{ merge: true }`.
 */
import { describe, expect, it } from 'bun:test';

import { parseYamlValue } from '../../src/evaluation/yaml-loader.js';

describe('parseYamlValue', () => {
  it('unwraps `<<: *anchor` merge keys without leaving `<<` as a sibling key', () => {
    const yaml = `
gov: &gov
  schema_version: "1.0"
  owasp_llm_top_10_2025: [LLM01]
  risk_tier: high

case:
  <<: *gov
  owasp_llm_top_10_2025: [LLM01, LLM06]
`;

    const parsed = parseYamlValue(yaml) as { case: Record<string, unknown> };

    // The `<<` key must NOT survive the parse — it should be unwrapped.
    expect(Object.keys(parsed.case).sort()).toEqual([
      'owasp_llm_top_10_2025',
      'risk_tier',
      'schema_version',
    ]);

    // Anchor fields are merged into the case.
    expect(parsed.case.schema_version).toBe('1.0');
    expect(parsed.case.risk_tier).toBe('high');

    // Case-level overrides win over anchor values for the same key.
    expect(parsed.case.owasp_llm_top_10_2025).toEqual(['LLM01', 'LLM06']);
  });
});
