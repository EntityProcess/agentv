import { describe, expect, it } from 'bun:test';

import {
  expandExpectedOutputShorthand,
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
