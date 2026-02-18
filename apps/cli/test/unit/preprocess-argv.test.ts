import { describe, expect, it } from 'bun:test';

import { preprocessArgv } from '../../src/index.js';

describe('preprocessArgv', () => {
  describe('eval deprecation alias', () => {
    it('rewrites `eval file.yaml` → `run file.yaml`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'run', 'file.yaml']);
    });

    it('rewrites `eval run file.yaml` → `run file.yaml`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'run', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'run', 'file.yaml']);
    });

    it('rewrites `eval prompt` → `prompt overview`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'prompt']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'overview']);
    });

    it('rewrites `eval prompt overview file.yaml` → `prompt overview file.yaml`', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', 'prompt', 'overview', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'overview', 'file.yaml']);
    });

    it('rewrites `eval prompt input file.yaml` → `prompt input file.yaml`', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'eval',
        'prompt',
        'input',
        'file.yaml',
        '--eval-id',
        'case-1',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'input',
        'file.yaml',
        '--eval-id',
        'case-1',
      ]);
    });

    it('rewrites `eval prompt judge file.yaml` → `prompt judge file.yaml`', () => {
      const result = preprocessArgv([
        'node',
        'agentv',
        'eval',
        'prompt',
        'judge',
        'file.yaml',
        '--eval-id',
        'case-1',
        '--answer-file',
        'out.txt',
      ]);
      expect(result).toEqual([
        'node',
        'agentv',
        'prompt',
        'judge',
        'file.yaml',
        '--eval-id',
        'case-1',
        '--answer-file',
        'out.txt',
      ]);
    });

    it('rewrites bare `eval` with flags → `run` with flags', () => {
      const result = preprocessArgv(['node', 'agentv', 'eval', '--dry-run', 'evals/*.yaml']);
      expect(result).toEqual(['node', 'agentv', 'run', '--dry-run', 'evals/*.yaml']);
    });
  });

  describe('prompt default subcommand', () => {
    it('inserts `overview` after `prompt` when followed by a file', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt', 'file.yaml']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'overview', 'file.yaml']);
    });

    it('does not insert `overview` when subcommand is already present', () => {
      for (const sub of ['overview', 'input', 'judge']) {
        const result = preprocessArgv(['node', 'agentv', 'prompt', sub, 'file.yaml']);
        expect(result).toEqual(['node', 'agentv', 'prompt', sub, 'file.yaml']);
      }
    });

    it('inserts `overview` when `prompt` has no arguments', () => {
      const result = preprocessArgv(['node', 'agentv', 'prompt']);
      expect(result).toEqual(['node', 'agentv', 'prompt', 'overview']);
    });
  });

  describe('passthrough', () => {
    it('does not modify `run` commands', () => {
      const argv = ['node', 'agentv', 'run', 'file.yaml', '--verbose'];
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
