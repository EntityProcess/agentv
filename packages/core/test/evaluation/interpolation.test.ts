import { describe, expect, it } from 'vitest';
import { interpolateEnv, interpolateTemplateVars } from '../../src/evaluation/interpolation.js';

describe('interpolateEnv', () => {
  const env = { HOME: '/home/user', PROJECT: 'agentv', EMPTY: '' };

  it('replaces ${{ VAR }} in a string', () => {
    expect(interpolateEnv('${{ HOME }}', env)).toBe('/home/user');
  });

  it('replaces ${{VAR}} without spaces', () => {
    expect(interpolateEnv('${{HOME}}', env)).toBe('/home/user');
  });

  it('handles partial/inline interpolation', () => {
    expect(interpolateEnv('${{ HOME }}/repos/${{ PROJECT }}', env)).toBe('/home/user/repos/agentv');
  });

  it('resolves missing variables to empty string', () => {
    expect(interpolateEnv('${{ MISSING }}', env)).toBe('');
  });

  it('resolves missing variable inline to empty string', () => {
    expect(interpolateEnv('prefix-${{ MISSING }}-suffix', env)).toBe('prefix--suffix');
  });

  it('passes through strings without interpolation syntax', () => {
    expect(interpolateEnv('plain string', env)).toBe('plain string');
  });

  it('passes through non-string primitives unchanged', () => {
    expect(interpolateEnv(42, env)).toBe(42);
    expect(interpolateEnv(true, env)).toBe(true);
    expect(interpolateEnv(null, env)).toBe(null);
    expect(interpolateEnv(undefined, env)).toBe(undefined);
  });

  it('recursively interpolates object values', () => {
    const input = {
      path: '${{ HOME }}/repos',
      nested: { url: '${{ PROJECT }}' },
      literal: 'no-vars',
    };
    expect(interpolateEnv(input, env)).toEqual({
      path: '/home/user/repos',
      nested: { url: 'agentv' },
      literal: 'no-vars',
    });
  });

  it('does not mutate the original object', () => {
    const input = { path: '${{ HOME }}' };
    const result = interpolateEnv(input, env);
    expect(result).not.toBe(input);
    expect(input.path).toBe('${{ HOME }}');
  });

  it('recursively interpolates arrays', () => {
    const input = ['${{ HOME }}', { key: '${{ PROJECT }}' }, 42];
    expect(interpolateEnv(input, env)).toEqual(['/home/user', { key: 'agentv' }, 42]);
  });

  it('handles empty string env values', () => {
    expect(interpolateEnv('${{ EMPTY }}', env)).toBe('');
  });

  describe('whole-value type coercion', () => {
    it('coerces "true" to boolean true', () => {
      expect(interpolateEnv('${{ FLAG }}', { FLAG: 'true' })).toBe(true);
    });

    it('coerces "false" to boolean false', () => {
      expect(interpolateEnv('${{ FLAG }}', { FLAG: 'false' })).toBe(false);
    });

    it('coerces integer string to number', () => {
      expect(interpolateEnv('${{ COUNT }}', { COUNT: '10' })).toBe(10);
    });

    it('coerces float string to number', () => {
      expect(interpolateEnv('${{ RATIO }}', { RATIO: '0.75' })).toBe(0.75);
    });

    it('leaves empty string as string (missing var)', () => {
      expect(interpolateEnv('${{ MISSING }}', {})).toBe('');
    });

    it('leaves plain string values as strings', () => {
      expect(interpolateEnv('${{ HOME }}', env)).toBe('/home/user');
    });

    it('does not coerce partial/inline substitutions', () => {
      // "true" appears only after inline replacement — no coercion
      expect(interpolateEnv('enabled=${{ FLAG }}', { FLAG: 'true' })).toBe('enabled=true');
    });

    it('coerces inside nested objects', () => {
      const input = { auto_push: '${{ PUSH }}', label: 'runs' };
      expect(interpolateEnv(input, { PUSH: 'true' })).toEqual({ auto_push: true, label: 'runs' });
    });

    // Numeric edge-case regression tests — these must stay as strings
    it('does not coerce scientific notation (1e3)', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: '1e3' })).toBe('1e3');
    });

    it('does not coerce hex strings (0x10)', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: '0x10' })).toBe('0x10');
    });

    it('does not coerce "Infinity"', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: 'Infinity' })).toBe('Infinity');
    });

    it('does not coerce whitespace-only string', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: ' ' })).toBe(' ');
    });

    it('does not coerce leading-zero string (00123)', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: '00123' })).toBe('00123');
    });

    it('coerces negative integer', () => {
      expect(interpolateEnv('${{ VAL }}', { VAL: '-7' })).toBe(-7);
    });
  });

  it('is case-sensitive for variable names', () => {
    expect(interpolateEnv('${{ home }}', env)).toBe('');
    expect(interpolateEnv('${{ HOME }}', env)).toBe('/home/user');
  });

  it('handles variables with underscores and digits', () => {
    const envWithSpecial = { MY_VAR_2: 'value' };
    expect(interpolateEnv('${{ MY_VAR_2 }}', envWithSpecial)).toBe('value');
  });
});

describe('interpolateTemplateVars', () => {
  const vars = {
    question: 'What is 2 + 2?',
    nested: { topic: 'math' },
    expected: { answer: '4' },
  };

  it('replaces {{ var }} in strings', () => {
    expect(interpolateTemplateVars('Answer clearly: {{question}}', vars)).toBe(
      'Answer clearly: What is 2 + 2?',
    );
  });

  it('supports dotted paths', () => {
    expect(interpolateTemplateVars('Topic: {{ nested.topic }}', vars)).toBe('Topic: math');
  });

  it('preserves missing variables instead of blanking them out', () => {
    expect(interpolateTemplateVars('Answer clearly: {{missing}}', vars)).toBe(
      'Answer clearly: {{missing}}',
    );
  });

  it('returns the original JSON value for whole-value substitutions', () => {
    expect(interpolateTemplateVars('{{expected}}', vars)).toEqual({ answer: '4' });
  });
});
