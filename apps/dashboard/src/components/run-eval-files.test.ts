import { describe, expect, it } from 'bun:test';

import {
  filterEvalFileOptions,
  selectEvalFileForSuiteFilter,
  toEvalFileOptions,
} from './run-eval-files';

const discoveredEvalFiles = [
  {
    path: '/workspace/evals/auth/basic.eval.yaml',
    relative_path: 'evals/auth/basic.eval.yaml',
    category: 'auth',
  },
  {
    path: '/workspace/evals/auth/oauth.eval.yaml',
    relative_path: 'evals/auth/oauth.eval.yaml',
    category: 'auth',
  },
  {
    path: '/workspace/evals/retrieval/chunking.eval.yaml',
    relative_path: 'evals/retrieval/chunking.eval.yaml',
    category: 'retrieval',
  },
  {
    path: '/workspace/evals/retrieval/rerank.eval.yaml',
    relative_path: 'evals/retrieval/rerank.eval.yaml',
    category: 'retrieval',
  },
  {
    path: '/workspace/evals/safety/pii.eval.yaml',
    relative_path: 'evals/safety/pii.eval.yaml',
    category: 'safety',
  },
  {
    path: '/workspace/evals/safety/secrets.eval.yaml',
    relative_path: 'evals/safety/secrets.eval.yaml',
    category: 'safety',
  },
];

describe('toEvalFileOptions', () => {
  it('keeps API wire keys at the boundary and exposes camelCase options', () => {
    expect(toEvalFileOptions([discoveredEvalFiles[0]])).toEqual([
      {
        path: '/workspace/evals/auth/basic.eval.yaml',
        relativePath: 'evals/auth/basic.eval.yaml',
        category: 'auth',
      },
    ]);
  });
});

describe('filterEvalFileOptions', () => {
  it('returns every discovered eval file when the suite filter has no active term', () => {
    const options = toEvalFileOptions(discoveredEvalFiles);

    expect(filterEvalFileOptions(options, '').map((file) => file.relativePath)).toEqual([
      'evals/auth/basic.eval.yaml',
      'evals/auth/oauth.eval.yaml',
      'evals/retrieval/chunking.eval.yaml',
      'evals/retrieval/rerank.eval.yaml',
      'evals/safety/pii.eval.yaml',
      'evals/safety/secrets.eval.yaml',
    ]);
  });

  it('filters using the token the user is currently typing', () => {
    const options = toEvalFileOptions(discoveredEvalFiles);

    expect(
      filterEvalFileOptions(options, 'evals/auth/basic.eval.yaml, safe').map(
        (file) => file.relativePath,
      ),
    ).toEqual(['evals/safety/pii.eval.yaml', 'evals/safety/secrets.eval.yaml']);
  });
});

describe('selectEvalFileForSuiteFilter', () => {
  it('populates an empty suite filter with the selected relative path', () => {
    expect(selectEvalFileForSuiteFilter('', 'evals/auth/basic.eval.yaml')).toBe(
      'evals/auth/basic.eval.yaml',
    );
  });

  it('replaces the active typed token with the selected relative path', () => {
    expect(selectEvalFileForSuiteFilter('auth', 'evals/auth/basic.eval.yaml')).toBe(
      'evals/auth/basic.eval.yaml',
    );
  });

  it('appends after an existing comma-delimited filter', () => {
    expect(
      selectEvalFileForSuiteFilter(
        'evals/auth/basic.eval.yaml, ',
        'evals/safety/secrets.eval.yaml',
      ),
    ).toBe('evals/auth/basic.eval.yaml, evals/safety/secrets.eval.yaml');
  });
});
