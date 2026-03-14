import { describe, expect, it } from 'vitest';
import {
  buildCompareCommand,
  buildConvertCommand,
  buildPromptEvalCommand,
  buildRunEvalCommand,
} from '../command-runner';

describe('command runner', () => {
  it('forwards all agentv eval arguments verbatim', () => {
    const args = ['evals.json', '--target', 'copilot-haiku', '--artifacts', '.agentv/artifacts'];

    expect(buildRunEvalCommand(args)).toEqual([
      'bun',
      expect.stringContaining('apps/cli/src/cli.ts'),
      'eval',
      ...args,
    ]);
  });

  it('preserves --test-id and --workers flags (regression for parsing bug)', () => {
    const args = ['dataset.eval.yaml', '--test-id', '1', '--workers', '2', '--dry-run'];

    const cmd = buildRunEvalCommand(args);

    expect(cmd).toContain('eval');
    expect(cmd).toContain('dataset.eval.yaml');
    expect(cmd).toContain('--test-id');
    expect(cmd).toContain('1');
    expect(cmd).toContain('--workers');
    expect(cmd).toContain('2');
    expect(cmd).toContain('--dry-run');

    // Verify the eval path is not "2" (the workers value)
    const evalIndex = cmd.indexOf('eval');
    expect(cmd[evalIndex + 1]).toBe('dataset.eval.yaml');
  });

  it('preserves --targets as file path, not comma-separated names', () => {
    const args = ['evals.json', '--targets', 'custom-targets.yaml'];

    const cmd = buildRunEvalCommand(args);

    expect(cmd).toContain('--targets');
    expect(cmd).toContain('custom-targets.yaml');
    // Should NOT split or join the path
    expect(cmd.join(' ')).not.toContain(',');
  });

  it('preserves repeatable --target flags for matrix evaluation', () => {
    const args = ['evals.json', '--target', 'gpt-4', '--target', 'claude-3'];

    const cmd = buildRunEvalCommand(args);

    expect(cmd.filter((arg) => arg === '--target')).toHaveLength(2);
    expect(cmd).toContain('gpt-4');
    expect(cmd).toContain('claude-3');
  });

  it('builds prompt, convert, and compare commands as thin wrappers', () => {
    expect(buildPromptEvalCommand(['overview', 'evals.json'])).toContain('prompt');
    expect(buildPromptEvalCommand(['input', 'evals.json', '--test-id', '1'])).toContain('input');
    expect(buildPromptEvalCommand(['judge', 'evals.json', '--test-id', '1'])).toContain('judge');
    expect(buildConvertCommand(['evals.json', '-o', 'eval.yaml'])).toContain('convert');
    expect(buildCompareCommand(['before.jsonl', 'after.jsonl'])).toContain('compare');
  });
});
