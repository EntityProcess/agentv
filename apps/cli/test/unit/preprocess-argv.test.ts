import { describe, expect, it } from 'bun:test';

import { preprocessArgv, usesDeprecatedStudioAlias } from '../../src/index.js';

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

    it('does not insert `run` when eval is followed by a known subcommand', () => {
      const argv = ['node', 'agentv', 'eval', 'assert', 'grader-name', '--output', 'test'];
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
});
