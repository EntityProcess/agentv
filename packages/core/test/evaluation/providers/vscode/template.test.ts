import { describe, expect, test } from 'bun:test';
import { renderTemplate } from '../../../../src/evaluation/providers/vscode/utils/template.js';

describe('renderTemplate', () => {
  test('replaces placeholders with values', () => {
    const result = renderTemplate('Hello {{name}}, file: {{path}}', {
      name: 'Alice',
      path: '/tmp/file.txt',
    });
    expect(result).toBe('Hello Alice, file: /tmp/file.txt');
  });

  test('is case-insensitive for variable names', () => {
    const result = renderTemplate('{{UserQuery}}', { userquery: 'test' });
    expect(result).toBe('test');
  });

  test('throws on missing variable', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow();
  });

  test('returns empty string for empty template', () => {
    expect(renderTemplate('', {})).toBe('');
  });
});
