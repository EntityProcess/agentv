import { describe, expect, it } from 'bun:test';

import {
  runContainsAssertion,
  runEqualsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
} from '../../../src/evaluation/evaluators/assertions.js';

describe('deterministic assertions', () => {
  describe('contains', () => {
    it('scores 1 when output contains value', () => {
      const result = runContainsAssertion('Hello world', 'world');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output contains "world"']);
    });

    it('scores 0 when output does not contain value', () => {
      const result = runContainsAssertion('Hello world', 'foo');
      expect(result.score).toBe(0);
      expect(result.misses).toEqual(['Output does not contain "foo"']);
    });
  });

  describe('regex', () => {
    it('scores 1 when output matches pattern', () => {
      const result = runRegexAssertion('risk: High', 'risk: (High|Critical)');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output matches pattern /risk: (High|Critical)/']);
    });

    it('scores 0 when output does not match pattern', () => {
      const result = runRegexAssertion('risk: Low', 'risk: (High|Critical)');
      expect(result.score).toBe(0);
      expect(result.misses).toEqual(['Output does not match pattern /risk: (High|Critical)/']);
    });
  });

  describe('is_json', () => {
    it('scores 1 for valid JSON', () => {
      const result = runIsJsonAssertion('{"key": "value"}');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output is valid JSON']);
    });

    it('scores 0 for invalid JSON', () => {
      const result = runIsJsonAssertion('not json');
      expect(result.score).toBe(0);
      expect(result.misses).toEqual(['Output is not valid JSON']);
    });
  });

  describe('equals', () => {
    it('scores 1 for exact match', () => {
      const result = runEqualsAssertion('DENIED', 'DENIED');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output equals "DENIED"']);
    });

    it('scores 0 for non-match', () => {
      const result = runEqualsAssertion('DENIED', 'APPROVED');
      expect(result.score).toBe(0);
      expect(result.misses).toEqual(['Output does not equal "APPROVED"']);
    });

    it('trims whitespace before comparing', () => {
      const result = runEqualsAssertion('  DENIED  ', 'DENIED');
      expect(result.score).toBe(1);
      expect(result.hits).toEqual(['Output equals "DENIED"']);
    });
  });
});
