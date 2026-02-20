import { describe, expect, it } from 'bun:test';

import { preprocessArgv } from '../../src/index.js';

describe('preprocessArgv', () => {
  describe('prompt default subcommand insertion', () => {
    it('inserts `eval overview` after `prompt` when followed by a file', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', 'overview', 'file.yaml']);
    });

    it('inserts `eval overview` when `prompt` has no arguments', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', 'overview']);
    });

    it('inserts `overview` after `prompt eval` when followed by a file', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt', 'eval', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', 'overview', 'file.yaml']);
    });

    it('inserts `overview` when `prompt eval` has no further arguments', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt', 'eval']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', 'overview']);
    });

    it('does not insert `overview` when sub-subcommand is already present', () => {
      for (const sub of ['overview', 'input', 'judge']) {
        const result = preprocessArgv(['node', 'agentv', 'prompt', 'eval', sub, 'file.yaml']);
        expect(result).toEqual(['node', 'agentv', 'prompt', 'eval', sub, 'file.yaml']);
      }
    });

    it('passes through `prompt eval input` with flags', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'prompt',
        'eval',
        'input',
        'file.yaml',
        '--test-id',
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

    it('passes through `prompt eval judge` with flags', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'prompt',
        'eval',
        'judge',
        'file.yaml',
        '--test-id',
        'case-1',
        '--answer-file',
        'out.txt',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'eval',
        'judge',
        'file.yaml',
        '--test-id',
        'case-1',
        '--answer-file',
        'out.txt',
      ]);
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
