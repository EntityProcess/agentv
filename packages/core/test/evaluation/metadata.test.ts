import { describe, expect, it } from 'bun:test';
import { parseMetadata } from '../../src/evaluation/metadata.js';

describe('parseMetadata', () => {
  it('parses valid metadata with all fields', () => {
    const result = parseMetadata({
      name: 'export-screening',
      description: 'Evaluates export screening accuracy',
      version: '1.0',
      author: 'acme-compliance',
      tags: ['compliance', 'agents'],
      license: 'Apache-2.0',
      requires: { agentv: '>=0.6.0' },
    });
    expect(result).toEqual({
      name: 'export-screening',
      description: 'Evaluates export screening accuracy',
      version: '1.0',
      author: 'acme-compliance',
      tags: ['compliance', 'agents'],
      license: 'Apache-2.0',
      requires: { agentv: '>=0.6.0' },
    });
  });

  it('returns undefined when no metadata fields present', () => {
    const result = parseMetadata({ tests: [] });
    expect(result).toBeUndefined();
  });

  it('allows name without description (description is optional)', () => {
    const result = parseMetadata({ name: 'test-eval' });
    expect(result).toEqual({ name: 'test-eval' });
  });

  it('ignores description without name (description is also a regular suite field)', () => {
    const result = parseMetadata({ description: 'A test eval' });
    expect(result).toBeUndefined();
  });

  it('validates name format (lowercase, digits, and hyphens only)', () => {
    expect(() => parseMetadata({ name: 'Invalid Name!', description: 'test' })).toThrow();
  });

  it('parses minimal metadata (name + description only)', () => {
    const result = parseMetadata({
      name: 'my-eval',
      description: 'A simple eval',
    });
    expect(result).toEqual({
      name: 'my-eval',
      description: 'A simple eval',
    });
  });

  it('parses an optional governance block at the top level', () => {
    const result = parseMetadata({
      name: 'red-team',
      governance: {
        schema_version: '1.0',
        owasp_llm_top_10_2025: ['LLM01'],
        controls: ['NIST-AI-RMF-1.0:MEASURE-2.7'],
        risk_tier: 'high',
      },
    });
    expect(result?.governance).toEqual({
      schema_version: '1.0',
      owasp_llm_top_10_2025: ['LLM01'],
      controls: ['NIST-AI-RMF-1.0:MEASURE-2.7'],
      risk_tier: 'high',
    });
  });

  it('parses governance from nested metadata.governance form', () => {
    const result = parseMetadata({
      name: 'red-team',
      metadata: {
        governance: { owasp_llm_top_10_2025: ['LLM06'], owner: 'security-team' },
      },
    });
    expect(result?.governance).toEqual({
      owasp_llm_top_10_2025: ['LLM06'],
      owner: 'security-team',
    });
  });

  it('returns metadata when only governance is present (no name)', () => {
    const result = parseMetadata({
      governance: { risk_tier: 'high' },
    });
    expect(result).toEqual({ governance: { risk_tier: 'high' } });
  });

  it('passes unknown governance keys through (custom taxonomies extend without forking)', () => {
    const result = parseMetadata({
      name: 'red-team',
      governance: { custom_company_taxonomy: ['X-1'] },
    });
    expect(result?.governance).toEqual({ custom_company_taxonomy: ['X-1'] });
  });
});
