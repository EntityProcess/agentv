import { describe, expect, it } from 'bun:test';

import { preprocessArgv } from '../../src/index.js';

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

    it('does not insert `run` for bare eval', () => {
      const argv = ['node', 'agentv', 'eval'];
      expect(preprocessArgv(argv)).toEqual(argv);
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
});
