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

  it('requires description when name is present', () => {
    expect(() => parseMetadata({ name: 'test-eval' })).toThrow();
  });

  it('requires name when description is present', () => {
    expect(() => parseMetadata({ description: 'A test eval' })).toThrow();
  });

  it('validates name format (lowercase, digits, and hyphens only)', () => {
    expect(() =>
      parseMetadata({ name: 'Invalid Name!', description: 'test' }),
    ).toThrow();
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
});
