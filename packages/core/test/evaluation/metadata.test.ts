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
});
