import { describe, expect, it } from 'vitest';

import { validateTemplateVariables } from '../../../src/evaluation/validation/prompt-validator.js';

describe('validateTemplateVariables', () => {
  it('passes when template contains {{ output }}', () => {
    expect(() => validateTemplateVariables('Score: {{ output }}', 'test.txt')).not.toThrow();
  });

  it('passes when template contains {{ expected_output }}', () => {
    expect(() =>
      validateTemplateVariables('Reference: {{ expected_output }}', 'test.txt'),
    ).not.toThrow();
  });

  it('passes when template contains deprecated {{ output_text }}', () => {
    expect(() => validateTemplateVariables('Score: {{ output_text }}', 'test.txt')).not.toThrow();
  });

  it('passes when template contains deprecated {{ expected_output_text }}', () => {
    expect(() =>
      validateTemplateVariables('Reference: {{ expected_output_text }}', 'test.txt'),
    ).not.toThrow();
  });

  it('throws when no required or deprecated variables are present', () => {
    expect(() => validateTemplateVariables('No variables here', 'test.txt')).toThrow(
      'Missing required fields',
    );
  });

  it('throws when only non-required variables are present', () => {
    expect(() =>
      validateTemplateVariables('Input: {{ input }} Criteria: {{ criteria }}', 'test.txt'),
    ).toThrow('Missing required fields');
  });
});
