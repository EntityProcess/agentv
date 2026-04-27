import { describe, expect, it } from 'bun:test';

import {
  runContainsAllAssertion,
  runContainsAnyAssertion,
  runContainsAssertion,
  runEqualsAssertion,
  runIsJsonAssertion,
  runRegexAssertion,
} from '../../../src/evaluation/graders/assertions.js';

describe('deterministic assertions', () => {
  describe('contains', () => {
    it('scores 1 when output contains value', () => {
      const result = runContainsAssertion('Hello world', 'world');
      expect(result.score).toBe(1);
      expect(result.assertions).toEqual([{ text: 'Output contains "world"', passed: true }]);
    });

    it('scores 0 when output does not contain value', () => {
      const result = runContainsAssertion('Hello world', 'foo');
      expect(result.score).toBe(0);
      expect(result.assertions).toEqual([{ text: 'Output does not contain "foo"', passed: false }]);
    });

    it('is case-sensitive', () => {
      expect(runContainsAssertion('Hello, world!', 'hello').score).toBe(0);
      expect(runContainsAssertion('hello, world!', 'hello').score).toBe(1);
    });
  });

  describe('contains-any', () => {
    it('is case-sensitive', () => {
      expect(runContainsAnyAssertion('Hello World', ['hello', 'world']).score).toBe(0);
      expect(runContainsAnyAssertion('Hello World', ['Hello', 'world']).score).toBe(1);
    });
  });

  describe('contains-all', () => {
    it('is case-sensitive', () => {
      expect(runContainsAllAssertion('Hello World', ['Hello', 'world']).score).toBe(0);
      expect(runContainsAllAssertion('Hello World', ['Hello', 'World']).score).toBe(1);
    });
  });

  describe('regex', () => {
    it('scores 1 when output matches pattern', () => {
      const result = runRegexAssertion('risk: High', 'risk: (High|Critical)');
      expect(result.score).toBe(1);
      expect(result.assertions).toEqual([
        { text: 'Output matches pattern /risk: (High|Critical)/', passed: true },
      ]);
    });

    it('scores 0 when output does not match pattern', () => {
      const result = runRegexAssertion('risk: Low', 'risk: (High|Critical)');
      expect(result.score).toBe(0);
      expect(result.assertions).toEqual([
        { text: 'Output does not match pattern /risk: (High|Critical)/', passed: false },
      ]);
    });
  });

  describe('is-json', () => {
    it('scores 1 for valid JSON', () => {
      const result = runIsJsonAssertion('{"key": "value"}');
      expect(result.score).toBe(1);
      expect(result.assertions).toEqual([{ text: 'Output is valid JSON', passed: true }]);
    });

    it('scores 0 for invalid JSON', () => {
      const result = runIsJsonAssertion('not json');
      expect(result.score).toBe(0);
      expect(result.assertions).toEqual([{ text: 'Output is not valid JSON', passed: false }]);
    });
  });

  describe('equals', () => {
    it('scores 1 for exact match', () => {
      const result = runEqualsAssertion('DENIED', 'DENIED');
      expect(result.score).toBe(1);
      expect(result.assertions).toEqual([{ text: 'Output equals "DENIED"', passed: true }]);
    });

    it('scores 0 for non-match', () => {
      const result = runEqualsAssertion('DENIED', 'APPROVED');
      expect(result.score).toBe(0);
      expect(result.assertions).toEqual([
        { text: 'Output does not equal "APPROVED"', passed: false },
      ]);
    });

    it('trims whitespace before comparing', () => {
      const result = runEqualsAssertion('  DENIED  ', 'DENIED');
      expect(result.score).toBe(1);
      expect(result.assertions).toEqual([{ text: 'Output equals "DENIED"', passed: true }]);
    });
  });
});
