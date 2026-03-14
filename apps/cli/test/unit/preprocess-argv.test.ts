import { describe, expect, it } from 'bun:test';

import { preprocessArgv } from '../../src/index.js';

describe('preprocessArgv', () => {
  describe('prompt default subcommand insertion', () => {
    it('does not rewrite `prompt` commands without explicit subcommands', () => {
      const argv = ['node', 'agentv', 'prompt', 'file.yaml'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not rewrite bare `prompt` commands', () => {
      const argv = ['node', 'agentv', 'prompt'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('does not insert a default accessor after `prompt eval` when followed by a file', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt', 'eval', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', 'file.yaml']);
    });

    it('does not insert a default accessor when `prompt eval` has no further arguments', () => {
      const argv = ['node', 'agentv', 'prompt', 'eval'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

    it('passes through `prompt eval --input` with flags', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'prompt',
        'eval',
        '--input',
        'file.yaml',
        '--test-id',
        'case-1',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'eval',
        '--input',
        'file.yaml',
        '--test-id',
        'case-1',
      ]);
    });

    it('passes through `prompt eval --expected-output` with flags', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'prompt',
        'eval',
        '--expected-output',
        'file.yaml',
        '--test-id',
        'case-1',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'eval',
        '--expected-output',
        'file.yaml',
        '--test-id',
        'case-1',
      ]);
    });

    it('passes through `prompt eval --list`', () => {
      const argv = ['node', 'agentv', 'prompt', 'eval', '--list', 'file.yaml'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });
  });

  describe('--eval-id convenience alias', () => {
    it('rewrites `--eval-id` → `--test-id`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml', '--eval-id', 'case-1']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'file.yaml', '--test-id', 'case-1']);
    });

    it('rewrites `--eval-id=value` → `--test-id=value`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml', '--eval-id=case-1']);
      expect(result).toEqual(['node', 'agentv', 'eval', 'file.yaml', '--test-id=case-1']);
    });

    it('rewrites `--eval-id` in prompt commands', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'prompt',
        'eval',
        'input',
        'file.yaml',
        '--eval-id',
        'case-1',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'eval',
        'input',
        'file.yaml',
        '--test-id',
        'case-1',
      ]);
    });
  });

  describe('passthrough', () => {
    it('does not modify `eval` commands', () => {
      const argv = ['node', 'agentv', 'eval', 'file.yaml', '--verbose'];
      expect(preprocessArgv(argv)).toEqual(argv);
    });

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
