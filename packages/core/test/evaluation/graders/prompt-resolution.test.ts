import { describe, expect, it } from 'bun:test';

import {
  containsTemplateVariables,
  resolveCustomPrompt,
} from '../../../src/evaluation/graders/prompt-resolution.js';

describe('containsTemplateVariables', () => {
  it('returns true for template with {{output}}', () => {
    expect(containsTemplateVariables('Grade the {{output}} against {{criteria}}')).toBe(true);
  });

  it('returns true for template with {{input}}', () => {
    expect(containsTemplateVariables('Evaluate {{input}} and {{output}}')).toBe(true);
  });

  it('returns true for template with {{expected_output}}', () => {
    expect(containsTemplateVariables('Compare {{output}} to {{expected_output}}')).toBe(true);
  });

  it('returns true for template with {{criteria}}', () => {
    expect(containsTemplateVariables('Check {{criteria}} for {{output}}')).toBe(true);
  });

  it('returns true for template with {{file_changes}}', () => {
    expect(containsTemplateVariables('Review {{file_changes}}')).toBe(true);
  });

  it('returns true for deprecated {{output_text}} variable', () => {
    expect(containsTemplateVariables('Grade the {{output_text}}')).toBe(true);
  });

  it('returns true for deprecated {{input_text}} variable', () => {
    expect(containsTemplateVariables('Evaluate {{input_text}}')).toBe(true);
  });

  it('returns true with whitespace in braces', () => {
    expect(containsTemplateVariables('Grade the {{ output }} carefully')).toBe(true);
  });

  it('returns false for bare criteria text without variables', () => {
    expect(containsTemplateVariables('Check if the response shows step-by-step work')).toBe(false);
  });

  it('returns false for text with unknown variable names', () => {
    expect(containsTemplateVariables('Evaluate {{answer}} against {{rubric}}')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsTemplateVariables('')).toBe(false);
  });

  it('returns false for text with single braces', () => {
    expect(containsTemplateVariables('Check {output} carefully')).toBe(false);
  });
});

describe('resolveCustomPrompt', () => {
  it('returns inline prompt string as-is', async () => {
    const result = await resolveCustomPrompt({
      prompt: 'Check if the response is correct',
    });
    expect(result).toBe('Check if the response is correct');
  });

  it('returns undefined when no prompt is configured', async () => {
    const result = await resolveCustomPrompt({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when prompt is not a string', async () => {
    const result = await resolveCustomPrompt({
      prompt: { command: ['node', 'script.js'] },
    });
    expect(result).toBeUndefined();
  });
});
