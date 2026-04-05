import { describe, expect, it } from 'bun:test';

import {
  CliHealthcheckInputSchema,
  CliHealthcheckSchema,
  CliTargetConfigSchema,
  CliTargetInputSchema,
  normalizeCliHealthcheck,
  normalizeCliTargetInput,
} from '../../../src/evaluation/providers/targets.js';

describe('CliHealthcheckInputSchema', () => {
  it('accepts snake_case healthcheck fields', () => {
    const httpInput = {
      url: 'http://localhost:8080/health',
      timeout_seconds: 30,
    };
    expect(CliHealthcheckInputSchema.safeParse(httpInput).success).toBe(true);

    const commandInput = {
      command: 'curl http://localhost:8080/health',
      cwd: '/app',
      timeout_seconds: 30,
    };
    expect(CliHealthcheckInputSchema.safeParse(commandInput).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    // Empty object (no url or command)
    expect(CliHealthcheckInputSchema.safeParse({}).success).toBe(false);

    // HTTP with empty URL
    expect(CliHealthcheckInputSchema.safeParse({ url: '' }).success).toBe(false);
  });
});

describe('CliTargetInputSchema', () => {
  it('accepts config with command field', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent run {PROMPT}',
      timeout_seconds: 60,
      keep_temp_files: true,
      files_format: '--file {path}',
    };

    const result = CliTargetInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe('agent run {PROMPT}');
    }
  });

  it('allows unknown properties (passthrough mode)', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent run {PROMPT}',
      custom_property: 'custom value',
      anotherUnknown: 123,
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(true);
  });

  it('accepts config with healthcheck', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent run {PROMPT}',
      healthcheck: {
        url: 'http://localhost:8080/health',
      },
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing command', () => {
    const input = { name: 'test-target', provider: 'cli' };

    const result = CliTargetInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('command');
    }
  });

  it('rejects non-cli provider', () => {
    const input = {
      name: 'test-target',
      provider: 'azure',
      command: 'agent run {PROMPT}',
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing name', () => {
    const input = { provider: 'cli', command: 'agent run {PROMPT}' };
    expect(CliTargetInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('CliHealthcheckSchema (strict)', () => {
  it('accepts valid normalized HTTP and command healthchecks', () => {
    const httpInput = {
      url: 'http://localhost:8080/health',
      timeoutMs: 30000,
    };
    expect(CliHealthcheckSchema.safeParse(httpInput).success).toBe(true);

    const commandInput = {
      command: 'curl http://localhost:8080/health',
      cwd: '/app',
      timeoutMs: 30000,
    };
    expect(CliHealthcheckSchema.safeParse(commandInput).success).toBe(true);

    // Without optional timeoutMs
    const minimalHttp = { url: 'http://localhost:8080/health' };
    expect(CliHealthcheckSchema.safeParse(minimalHttp).success).toBe(true);
  });

  it('rejects unknown properties (strict mode)', () => {
    const input = {
      url: 'http://localhost:8080/health',
      unknownProperty: 'value',
    };

    expect(CliHealthcheckSchema.safeParse(input).success).toBe(false);
  });

  it('rejects snake_case properties (expects normalized only)', () => {
    const input = {
      url: 'http://localhost:8080/health',
      timeout_seconds: 30,
    };

    expect(CliHealthcheckSchema.safeParse(input).success).toBe(false);
  });
});

describe('CliTargetConfigSchema (strict)', () => {
  it('accepts valid normalized config with all fields', () => {
    const input = {
      command: 'agent run {PROMPT}',
      filesFormat: '--file {path}',
      cwd: '/app',
      timeoutMs: 60000,
      verbose: true,
      keepTempFiles: false,
      healthcheck: {
        url: 'http://localhost:8080/health',
      },
    };

    expect(CliTargetConfigSchema.safeParse(input).success).toBe(true);

    // Minimal config
    expect(CliTargetConfigSchema.safeParse({ command: 'agent run {PROMPT}' }).success).toBe(true);
  });

  it('rejects unknown properties (strict mode)', () => {
    const input = { command: 'agent run {PROMPT}', unknownField: 'value' };
    expect(CliTargetConfigSchema.safeParse(input).success).toBe(false);
  });
});

describe('normalizeCliHealthcheck', () => {
  const mockEnv = {
    HEALTH_URL: 'http://resolved.example.com/health',
    HEALTH_CMD: 'curl http://localhost/health',
  };

  it('normalizes HTTP and command healthchecks with timeout conversion', () => {
    // HTTP with snake_case timeout
    const httpInput = {
      url: '${{ HEALTH_URL }}',
      timeout_seconds: 30,
    };

    const httpResult = normalizeCliHealthcheck(httpInput, mockEnv, 'test-target');
    expect('url' in httpResult).toBe(true);
    if ('url' in httpResult) {
      expect(httpResult.url).toBe('http://resolved.example.com/health');
      expect(httpResult.timeoutMs).toBe(30000);
    }

    const commandInput = {
      command: 'health-check.sh',
      timeout_seconds: 5,
    };

    const commandResult = normalizeCliHealthcheck(commandInput, {}, 'test-target');
    expect('command' in commandResult).toBe(true);
    if ('command' in commandResult) {
      expect(commandResult.command).toBe('health-check.sh');
      expect(commandResult.timeoutMs).toBe(5000);
    }
  });

  it('throws when healthcheck lacks both command and url', () => {
    const input = { cwd: '/app' } as unknown as Parameters<typeof normalizeCliHealthcheck>[0];

    expect(() => normalizeCliHealthcheck(input, {}, 'test-target')).toThrow(
      /command.*or.*url.*required/i,
    );
  });
});

describe('normalizeCliTargetInput', () => {
  const mockEnv = {
    CLI_CMD: 'custom-agent run {PROMPT}',
    WORK_DIR: '/custom/workdir',
    HEALTH_ENDPOINT: 'http://localhost:8080/health',
  };

  it('normalizes command with timeout conversion', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent run {PROMPT}',
      files_format: '--file {path}',
      timeout_seconds: 60,
      keep_temp_files: true,
      cli_verbose: true,
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.command).toBe('agent run {PROMPT}');
    expect(result.filesFormat).toBe('--file {path}');
    expect(result.timeoutMs).toBe(60000);
    expect(result.keepTempFiles).toBe(true);
    expect(result.verbose).toBe(true);
  });

  it('resolves environment variables in command and cwd', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: '${{ CLI_CMD }}',
      cwd: '${{ WORK_DIR }}',
    };

    const result = normalizeCliTargetInput(input, mockEnv);

    expect(result.command).toBe('custom-agent run {PROMPT}');
    expect(result.cwd).toBe('/custom/workdir');
  });

  it('handles fractional seconds correctly', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent {PROMPT}',
      timeout_seconds: 1.5,
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.timeoutMs).toBe(1500);
  });

  it('produces minimal output when only required fields provided', () => {
    const input = {
      name: 'minimal-target',
      provider: 'cli',
      command: 'simple-agent {PROMPT}',
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.command).toBe('simple-agent {PROMPT}');
    expect(result.filesFormat).toBeUndefined();
    expect(result.timeoutMs).toBeUndefined();
    expect(result.verbose).toBeUndefined();
    expect(result.keepTempFiles).toBeUndefined();
    expect(result.healthcheck).toBeUndefined();
  });

  it('normalizes nested healthcheck configuration', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent {PROMPT}',
      healthcheck: {
        url: '${{ HEALTH_ENDPOINT }}',
        timeout_seconds: 10,
      },
    };

    const result = normalizeCliTargetInput(input, mockEnv);

    expect(result.healthcheck).toBeDefined();
    if (result.healthcheck && 'url' in result.healthcheck) {
      expect(result.healthcheck.url).toBe('http://localhost:8080/health');
      expect(result.healthcheck.timeoutMs).toBe(10000);
    }
  });

  it('accepts attachments_format as alias for files_format', () => {
    const snakeInput = {
      name: 'test-target',
      provider: 'cli',
      command: 'agent {PROMPT}',
      attachments_format: '--attach {path}',
    };
    expect(normalizeCliTargetInput(snakeInput, {}).filesFormat).toBe('--attach {path}');
  });
});
