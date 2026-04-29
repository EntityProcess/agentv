import { describe, expect, it, spyOn } from 'bun:test';

import { parseEnvOutput, runBeforeSessionHook } from '../../src/evaluation/hooks.js';

describe('parseEnvOutput', () => {
  it('parses dotenv KEY=value lines', () => {
    expect(parseEnvOutput('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('parses export KEY="value" lines (double quotes)', () => {
    expect(parseEnvOutput('export FOO="bar"')).toEqual({ FOO: 'bar' });
  });

  it("parses export KEY='value' lines (single quotes)", () => {
    expect(parseEnvOutput("export FOO='bar'")).toEqual({ FOO: 'bar' });
  });

  it('parses export KEY=value without quotes', () => {
    expect(parseEnvOutput('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('allows values containing equals signs', () => {
    expect(parseEnvOutput('FOO=a=b=c')).toEqual({ FOO: 'a=b=c' });
  });

  it('handles empty values', () => {
    expect(parseEnvOutput('FOO=')).toEqual({ FOO: '' });
  });

  it('ignores comment lines', () => {
    expect(parseEnvOutput('# This is a comment\nFOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('ignores blank lines', () => {
    expect(parseEnvOutput('\n\nFOO=bar\n\n')).toEqual({ FOO: 'bar' });
  });

  it('ignores lines that are not env var assignments', () => {
    expect(parseEnvOutput('not-valid\nFOO=bar\necho hello')).toEqual({ FOO: 'bar' });
  });

  it('parses multiple mixed-format lines', () => {
    const input = [
      'export KEY1="value1"',
      "export KEY2='value2'",
      'KEY3=value3',
      'export KEY4=value4',
    ].join('\n');
    expect(parseEnvOutput(input)).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
      KEY3: 'value3',
      KEY4: 'value4',
    });
  });

  it('returns empty object for empty stdout', () => {
    expect(parseEnvOutput('')).toEqual({});
  });

  it('accepts keys with underscores and digits', () => {
    expect(parseEnvOutput('MY_KEY_123=hello')).toEqual({ MY_KEY_123: 'hello' });
  });
});

describe('runBeforeSessionHook', () => {
  it('logs hook startup without ANSI color codes', () => {
    const envKey = 'AGENTV_TEST_BEFORE_SESSION_HOOK_COLOR';
    const originalValue = process.env[envKey];
    const command = `bun -e "process.stdout.write('${envKey}=plain\\n')"`;
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    delete process.env[envKey];

    try {
      runBeforeSessionHook(command);

      expect(logSpy.mock.calls[0]?.[0]).toBe(`Running before_session hook: ${command}`);
      expect(process.env[envKey]).toBe('plain');
    } finally {
      logSpy.mockRestore();

      if (originalValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = originalValue;
      }
    }
  });
});
