import { describe, expect, it } from 'bun:test';

import {
  expandExpectedOutputShorthand,
  expandInputFilesShorthand,
  expandInputShorthand,
  resolveExpectedMessages,
  resolveInputMessages,
} from '../../../src/evaluation/loaders/shorthand-expansion.js';

describe('expandInputShorthand', () => {
  it('expands string to single user message', () => {
    const result = expandInputShorthand('What is 2+2?');

    expect(result).toEqual([{ role: 'user', content: 'What is 2+2?' }]);
  });

  it('passes through message array', () => {
    const messages = [
      { role: 'system', content: 'You are a calculator' },
      { role: 'user', content: 'What is 2+2?' },
    ];

    const result = expandInputShorthand(messages);

    expect(result).toEqual(messages);
  });

  it('filters invalid messages from array', () => {
    const messages = [
      { role: 'user', content: 'Valid' },
      { invalid: 'message' },
      { role: 'assistant', content: 'Also valid' },
    ];

    const result = expandInputShorthand(messages);

    expect(result).toHaveLength(2);
    expect(result?.[0].content).toBe('Valid');
    expect(result?.[1].content).toBe('Also valid');
  });

  it('returns undefined for null', () => {
    expect(expandInputShorthand(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(expandInputShorthand(undefined)).toBeUndefined();
  });

  it('returns undefined for invalid types', () => {
    expect(expandInputShorthand(123 as unknown as string)).toBeUndefined();
    expect(expandInputShorthand(true as unknown as string)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(expandInputShorthand([])).toBeUndefined();
  });

  it('returns undefined for array of invalid messages', () => {
    const messages = [{ invalid: 'message' }, { also: 'invalid' }];
    expect(expandInputShorthand(messages)).toBeUndefined();
  });

  it('accepts messages whose content array mixes plain strings and structured blocks', () => {
    const messages = [
      {
        role: 'user',
        content: ['Use the local file.', { type: 'file', value: '/README.md' }],
      },
    ];

    const result = expandInputShorthand(messages);

    expect(result).toHaveLength(1);
    const content = result?.[0].content;
    expect(Array.isArray(content)).toBe(true);
    const items = content as Array<unknown>;
    expect(items).toHaveLength(2);
    expect(items[0]).toBe('Use the local file.');
    expect(items[1]).toEqual({ type: 'file', value: '/README.md' });
  });
});

describe('expandExpectedOutputShorthand', () => {
  it('expands string to single assistant message', () => {
    const result = expandExpectedOutputShorthand('The answer is 4');

    expect(result).toEqual([{ role: 'assistant', content: 'The answer is 4' }]);
  });

  it('expands object to assistant message with structured content', () => {
    const structured = { riskLevel: 'High', confidence: 0.95 };

    const result = expandExpectedOutputShorthand(structured);

    expect(result).toEqual([{ role: 'assistant', content: structured }]);
  });

  it('passes through message array', () => {
    const messages = [
      { role: 'assistant', content: 'First response' },
      { role: 'assistant', content: { result: 'structured' } },
    ];

    const result = expandExpectedOutputShorthand(messages);

    expect(result).toEqual(messages);
  });

  it('wraps non-message array as assistant content', () => {
    const arrayContent = [{ item: 1 }, { item: 2 }];

    const result = expandExpectedOutputShorthand(arrayContent);

    expect(result).toEqual([{ role: 'assistant', content: arrayContent }]);
  });

  it('returns undefined for null', () => {
    expect(expandExpectedOutputShorthand(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(expandExpectedOutputShorthand(undefined)).toBeUndefined();
  });

  it('handles message with tool_calls', () => {
    const messages = [
      {
        role: 'assistant',
        tool_calls: [{ tool: 'Read', input: { file_path: 'config.json' } }],
      },
    ];

    const result = expandExpectedOutputShorthand(messages);

    expect(result).toEqual(messages);
  });
});

describe('expandInputFilesShorthand', () => {
  it('expands single file path + string input to user message with content blocks', () => {
    const result = expandInputFilesShorthand(
      ['evals/files/sales.csv'],
      'Summarize the monthly trends in this CSV.',
    );

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'file', value: 'evals/files/sales.csv' },
          { type: 'text', value: 'Summarize the monthly trends in this CSV.' },
        ],
      },
    ]);
  });

  it('places multiple file blocks before the text block', () => {
    const result = expandInputFilesShorthand(
      ['evals/files/a.csv', 'evals/files/b.csv'],
      'Compare these two files.',
    );

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'file', value: 'evals/files/a.csv' },
          { type: 'file', value: 'evals/files/b.csv' },
          { type: 'text', value: 'Compare these two files.' },
        ],
      },
    ]);
  });

  it('returns undefined when input_files is undefined', () => {
    expect(expandInputFilesShorthand(undefined, 'hello')).toBeUndefined();
  });

  it('returns undefined when input_files is null', () => {
    expect(expandInputFilesShorthand(null, 'hello')).toBeUndefined();
  });

  it('returns undefined when input_files is not an array', () => {
    expect(expandInputFilesShorthand('not-an-array', 'hello')).toBeUndefined();
  });

  it('returns undefined when input_files array is empty after filtering non-strings', () => {
    expect(expandInputFilesShorthand([42, true, null], 'hello')).toBeUndefined();
  });

  it('returns undefined when input is not a string (multi-turn not supported in v1)', () => {
    const multiTurn = [{ role: 'user', content: 'Hello' }];
    expect(expandInputFilesShorthand(['file.csv'], multiTurn)).toBeUndefined();
  });

  it('returns undefined when input is undefined', () => {
    expect(expandInputFilesShorthand(['file.csv'], undefined)).toBeUndefined();
  });

  it('filters non-string entries from input_files array', () => {
    const result = expandInputFilesShorthand(
      ['valid.csv', 42, null, 'also-valid.txt'],
      'Analyze these files.',
    );

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'file', value: 'valid.csv' },
          { type: 'file', value: 'also-valid.txt' },
          { type: 'text', value: 'Analyze these files.' },
        ],
      },
    ]);
  });
});

describe('resolveInputMessages', () => {
  it('resolves input message array', () => {
    const raw = {
      input: [{ role: 'user', content: 'Hello' }],
    };

    const result = resolveInputMessages(raw);

    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('expands input shorthand string', () => {
    const raw = {
      input: 'Simple query',
    };

    const result = resolveInputMessages(raw);

    expect(result).toEqual([{ role: 'user', content: 'Simple query' }]);
  });

  it('handles input as message array', () => {
    const raw = {
      input: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User query' },
      ],
    };

    const result = resolveInputMessages(raw);

    expect(result).toHaveLength(2);
    expect(result?.[0].role).toBe('system');
    expect(result?.[1].role).toBe('user');
  });

  it('returns undefined when not present', () => {
    const raw = { id: 'test' };

    const result = resolveInputMessages(raw);

    expect(result).toBeUndefined();
  });

  it('expands input_files shorthand with string input', () => {
    const raw = {
      input_files: ['evals/files/sales.csv'],
      input: 'Summarize the monthly trends in this CSV.',
    };

    const result = resolveInputMessages(raw);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'file', value: 'evals/files/sales.csv' },
          { type: 'text', value: 'Summarize the monthly trends in this CSV.' },
        ],
      },
    ]);
  });

  it('prefers input_files expansion over plain input when input_files is present', () => {
    const raw = {
      input_files: ['data.csv'],
      input: 'What does this show?',
    };

    const result = resolveInputMessages(raw);

    expect(result).toHaveLength(1);
    expect(result?.[0].role).toBe('user');
    const content = result?.[0].content;
    expect(Array.isArray(content)).toBe(true);
  });

  it('returns undefined when input_files is present but input is a multi-turn array', () => {
    const raw = {
      input_files: ['file.csv'],
      input: [{ role: 'user', content: 'Hello' }],
    };

    const result = resolveInputMessages(raw);

    expect(result).toBeUndefined();
  });
});

describe('resolveExpectedMessages', () => {
  it('resolves expected_output message array', () => {
    const raw = {
      expected_output: [{ role: 'assistant', content: 'Hello' }],
    };

    const result = resolveExpectedMessages(raw);

    expect(result).toEqual([{ role: 'assistant', content: 'Hello' }]);
  });

  it('expands expected_output shorthand string', () => {
    const raw = {
      expected_output: 'Simple response',
    };

    const result = resolveExpectedMessages(raw);

    expect(result).toEqual([{ role: 'assistant', content: 'Simple response' }]);
  });

  it('expands expected_output shorthand object', () => {
    const raw = {
      expected_output: { riskLevel: 'High' },
    };

    const result = resolveExpectedMessages(raw);

    expect(result).toEqual([{ role: 'assistant', content: { riskLevel: 'High' } }]);
  });

  it('handles expected_output as message array', () => {
    const raw = {
      expected_output: [
        { role: 'assistant', content: 'First' },
        { role: 'assistant', content: 'Second' },
      ],
    };

    const result = resolveExpectedMessages(raw);

    expect(result).toHaveLength(2);
    expect(result?.[0].content).toBe('First');
    expect(result?.[1].content).toBe('Second');
  });

  it('returns undefined when not present', () => {
    const raw = { id: 'test' };

    const result = resolveExpectedMessages(raw);

    expect(result).toBeUndefined();
  });
});
