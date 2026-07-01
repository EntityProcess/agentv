import { describe, expect, it } from 'bun:test';

import {
  matchesTagFilters,
  resolveEffectiveTags,
  resolveExperimentNamespace,
  splitCliTags,
  syncTagsExperiment,
} from '../../../src/commands/eval/run-eval.js';

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

describe('splitCliTags', () => {
  it('routes bare values to selection tags and key=value to the tag map', () => {
    const { selectionTags, tagMap } = splitCliTags([
      'agent',
      'experiment=baseline-v2',
      'slow',
      'team=compliance',
    ]);
    expect(selectionTags).toEqual(['agent', 'slow']);
    expect(tagMap).toEqual({ experiment: 'baseline-v2', team: 'compliance' });
  });

  it('keeps an explicit empty value (--tag experiment=)', () => {
    const { selectionTags, tagMap } = splitCliTags(['experiment=']);
    expect(selectionTags).toEqual([]);
    expect(tagMap).toEqual({ experiment: '' });
  });

  it('lets the last value win for a repeated key', () => {
    expect(splitCliTags(['experiment=a', 'experiment=b']).tagMap).toEqual({ experiment: 'b' });
  });

  it('ignores entries with an empty key', () => {
    expect(splitCliTags(['=value']).tagMap).toEqual({});
  });

  it('returns empty shapes for undefined input', () => {
    expect(splitCliTags(undefined)).toEqual({ selectionTags: [], tagMap: {} });
  });
});

describe('resolveEffectiveTags', () => {
  it('merges eval < project config < CLI with CLI winning', () => {
    expect(
      resolveEffectiveTags({
        evalTags: { experiment: 'eval', team: 'a' },
        configTags: { experiment: 'config' },
        cliTags: { experiment: 'cli' },
      }),
    ).toEqual({ experiment: 'cli', team: 'a' });
  });

  it('lets project config override eval when no CLI value is present', () => {
    expect(
      resolveEffectiveTags({
        evalTags: { experiment: 'eval' },
        configTags: { experiment: 'config' },
      }),
    ).toEqual({ experiment: 'config' });
  });

  it('returns undefined when no layer contributes', () => {
    expect(resolveEffectiveTags({})).toBeUndefined();
  });
});

describe('resolveExperimentNamespace', () => {
  const base = {
    isMultiEval: false,
    suiteName: 'my-suite',
    resultGroupName: 'my-suite',
  };

  it('prefers an explicit --experiment over tags.experiment and the default', () => {
    expect(
      resolveExperimentNamespace({ ...base, cliExperiment: 'cli-exp', tagsExperiment: 'tag-exp' }),
    ).toEqual({ experiment: 'cli-exp', source: 'cli' });
  });

  it('uses tags.experiment when no --experiment is given', () => {
    expect(resolveExperimentNamespace({ ...base, tagsExperiment: 'tag-exp' })).toEqual({
      experiment: 'tag-exp',
      source: 'tags',
    });
  });

  it('falls back to the eval-metadata default when neither is set (e.g. --tag experiment=)', () => {
    expect(resolveExperimentNamespace({ ...base })).toEqual({
      experiment: 'my-suite',
      source: 'eval_metadata',
    });
  });

  it('falls back to the eval filename when there is no suite name', () => {
    expect(
      resolveExperimentNamespace({
        isMultiEval: false,
        resultGroupName: 'dataset',
      }),
    ).toEqual({ experiment: 'dataset', source: 'eval_filename' });
  });

  it('labels multi-eval runs when no CLI/tags experiment is set', () => {
    expect(
      resolveExperimentNamespace({ isMultiEval: true, resultGroupName: 'multi-eval' }),
    ).toEqual({ experiment: 'multi-eval', source: 'multi_eval' });
  });

  it('lets tags.experiment win over the multi-eval default', () => {
    expect(
      resolveExperimentNamespace({
        isMultiEval: true,
        tagsExperiment: 'tag-exp',
        resultGroupName: 'multi-eval',
      }),
    ).toEqual({ experiment: 'tag-exp', source: 'tags' });
  });
});

describe('syncTagsExperiment', () => {
  it('returns undefined when there is no tags map', () => {
    expect(
      syncTagsExperiment(undefined, { experimentIsIntentional: true, normalizedExperiment: 'x' }),
    ).toBeUndefined();
  });

  it('does not inject a default experiment when only non-experiment tags are set', () => {
    expect(
      syncTagsExperiment(
        { team: 'core' },
        { experimentIsIntentional: false, normalizedExperiment: 'my-suite' },
      ),
    ).toEqual({ team: 'core' });
  });

  it('syncs the experiment key when it was authored in the tags map', () => {
    expect(
      syncTagsExperiment(
        { experiment: 'baseline', team: 'core' },
        { experimentIsIntentional: false, normalizedExperiment: 'baseline' },
      ),
    ).toEqual({ experiment: 'baseline', team: 'core' });
  });

  it('syncs the experiment key to a --experiment override alongside other tags', () => {
    expect(
      syncTagsExperiment(
        { team: 'core' },
        { experimentIsIntentional: true, normalizedExperiment: 'cli-wins' },
      ),
    ).toEqual({ team: 'core', experiment: 'cli-wins' });
  });
});
