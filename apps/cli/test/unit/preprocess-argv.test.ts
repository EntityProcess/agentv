import { describe, expect, it } from 'bun:test';

import {
  inferEvalSubcommand,
  preprocessArgv,
  shouldRunBeforeSessionHook,
  usesDeprecatedStudioAlias,
} from '../../src/index.js';

describe('preprocessArgv', () => {
  describe('--eval-id convenience alias', () => {
    it('rewrites `--eval-id` → `--test-id`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml', '--eval-id', 'case-1']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'run', 'file.yaml', '--test-id', 'case-1']);
    });

    it('rewrites `--eval-id=value` → `--test-id=value`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml', '--eval-id=case-1']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'run', 'file.yaml', '--test-id=case-1']);
    });
  });

  describe('eval implicit run subcommand', () => {
    it('inserts `run` when eval is followed by a file path', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml', '--verbose']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'run', 'file.yaml', '--verbose']);
    });

    it('inserts `vitest` when eval is followed by a verifier test file', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'graders/welcome-banner.test.ts']);
      expect(result).toEqual([
        'node',
        'agentv',
        'eval',
        'vitest',
        'graders/welcome-banner.test.ts',
      ]);
    });

    it('inserts `vitest` for Vercel-style EVAL.ts verifier files', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'evals/task/EVAL.ts']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'vitest', 'evals/task/EVAL.ts']);
    });

    it('does not insert `run` when eval is followed by a known subcommand', () => {
      const argv = ['node', 'agentv', 'eval', 'assert', 'grader-name', '--output', 'test'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not insert `run` for eval bundle', () => {
      const argv = ['node', 'agentv', 'eval', 'bundle', 'evals/demo.eval.yaml', '--out', 'bundle'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not insert `run` for eval vitest', () => {
      const argv = ['node', 'agentv', 'eval', 'vitest', 'graders/welcome-banner.test.ts'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not insert `run` when eval is followed by --help', () => {
      const argv = ['node', 'agentv', 'eval', '--help'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('inserts `run` for bare eval so the run handler can launch the wizard', () => {
      const argv = ['node', 'agentv', 'eval'];
      expect(preprocessArgv(argv)).toEqual(['node', 'agentv', 'eval', 'run']);
    });

    it('inserts `run` when eval is followed by a flag', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', '--verbose', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'run', '--verbose', 'file.yaml']);
    });
  });

  describe('passthrough', () => {
    it('does not modify other commands', () => {
      const argv = ['node', 'agentv', 'compare', 'a.jsonl', 'b.jsonl'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not modify empty argv', () => {
      const argv = ['node', 'agentv'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });
  });

  describe('dashboard command alias', () => {
    it('rewrites top-level `studio` to `dashboard`', () => {
      const result = preprocessArgv(['node', 'agentv', 'studio', '--port', '4117']);
      expect(result).toEqual(['node', 'agentv', 'dashboard', '--port', '4117']);
    });

    it('detects top-level `studio` as a deprecated alias', () => {
      expect(usesDeprecatedStudioAlias(['node', 'agentv', 'studio'])).toBe(true);
    });

    it('does not treat nested `studio` arguments as the deprecated command alias', () => {
      const argv = ['node', 'agentv', 'dashboard', 'studio'];
      expect(preprocessArgv(argv)).toEqual(argv);
      expect(usesDeprecatedStudioAlias(argv)).toBe(false);
    });

    it('does not rewrite eval file arguments named `studio`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'studio']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'run', 'studio']);
    });

    it('does not modify top-level `dashboard`', () => {
      const argv = ['node', 'agentv', 'dashboard', '--single'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });
  });

  describe('before_session hook guard', () => {
    it('skips before_session hooks for the Vitest protocol adapter', () => {
      expect(
        shouldRunBeforeSessionHook([
          'node',
          'agentv',
          'eval',
          'vitest',
          'graders/welcome-banner.test.ts',
        ]),
      ).toBe(false);
    });

    it('keeps before_session hooks for normal eval runs', () => {
      expect(shouldRunBeforeSessionHook(['node', 'agentv', 'eval', 'run', 'evals/demo.yaml'])).toBe(
        true,
      );
    });
  });

  describe('inferEvalSubcommand', () => {
    it.each([
      ['graders/welcome-banner.test.ts', 'vitest'],
      ['graders/welcome-banner.spec.tsx', 'vitest'],
      ['vercel/evals/task/EVAL.ts', 'vitest'],
      ['evals/greeting.eval.ts', 'run'],
      ['evals/dataset.eval.yaml', 'run'],
      ['graders/custom-grader.ts', 'run'],
    ] as const)('infers %s as %s', (input, expected) => {
      expect(inferEvalSubcommand(input)).toBe(expected);
    });
  });
});
