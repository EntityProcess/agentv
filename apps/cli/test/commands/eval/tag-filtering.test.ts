import { describe, expect, it } from 'bun:test';

import { matchesTagFilters } from '../../../src/commands/eval/run-eval.js';

describe('matchesTagFilters', () => {
  describe('no filters', () => {
    it('accepts files with tags', () => {
      expect(matchesTagFilters(['agent', 'slow'], [], [])).toBe(true);
    });

    it('accepts files without tags', () => {
      expect(matchesTagFilters(undefined, [], [])).toBe(true);
    });

    it('accepts files with empty tags', () => {
      expect(matchesTagFilters([], [], [])).toBe(true);
    });
  });

  describe('--tag (include)', () => {
    it('accepts file with matching tag', () => {
      expect(matchesTagFilters(['agent', 'fast'], ['agent'], [])).toBe(true);
    });

    it('rejects file without matching tag', () => {
      expect(matchesTagFilters(['slow', 'multi-provider'], ['agent'], [])).toBe(false);
    });

    it('requires all specified tags (AND logic)', () => {
      expect(matchesTagFilters(['agent', 'fast'], ['agent', 'fast'], [])).toBe(true);
      expect(matchesTagFilters(['agent'], ['agent', 'fast'], [])).toBe(false);
    });

    it('rejects files with no tags when --tag is specified', () => {
      expect(matchesTagFilters(undefined, ['agent'], [])).toBe(false);
      expect(matchesTagFilters([], ['agent'], [])).toBe(false);
    });
  });

  describe('--exclude-tag', () => {
    it('accepts file without excluded tag', () => {
      expect(matchesTagFilters(['agent', 'fast'], [], ['slow'])).toBe(true);
    });

    it('rejects file with excluded tag', () => {
      expect(matchesTagFilters(['agent', 'slow'], [], ['slow'])).toBe(false);
    });

    it('rejects file if any excluded tag is present (AND logic)', () => {
      expect(matchesTagFilters(['agent', 'slow'], [], ['slow', 'flaky'])).toBe(false);
      expect(matchesTagFilters(['agent', 'flaky'], [], ['slow', 'flaky'])).toBe(false);
    });

    it('accepts files with no tags when only --exclude-tag is specified', () => {
      expect(matchesTagFilters(undefined, [], ['slow'])).toBe(true);
      expect(matchesTagFilters([], [], ['slow'])).toBe(true);
    });
  });

  describe('combined --tag and --exclude-tag', () => {
    it('accepts file matching include and not matching exclude', () => {
      expect(matchesTagFilters(['agent', 'fast'], ['agent'], ['slow'])).toBe(true);
    });

    it('rejects file matching include but also matching exclude', () => {
      expect(matchesTagFilters(['agent', 'slow'], ['agent'], ['slow'])).toBe(false);
    });

    it('rejects file not matching include even if not matching exclude', () => {
      expect(matchesTagFilters(['fast'], ['agent'], ['slow'])).toBe(false);
    });
  });
});
