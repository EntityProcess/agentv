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
  it('accepts HTTP and command healthchecks with mixed snake_case/camelCase', () => {
    // HTTP with snake_case timeout
    const httpInput = {
      type: 'http' as const,
      url: 'http://localhost:8080/health',
      timeout_seconds: 30,
    };
    expect(CliHealthcheckInputSchema.safeParse(httpInput).success).toBe(true);

    // Command with camelCase properties
    const commandInput = {
      type: 'command' as const,
      commandTemplate: 'curl http://localhost:8080/health',
      cwd: '/app',
      timeoutSeconds: 30,
    };
    expect(CliHealthcheckInputSchema.safeParse(commandInput).success).toBe(true);
  });

  it('rejects invalid type value', () => {
    const input = { type: 'invalid', url: 'http://localhost:8080/health' };
    expect(CliHealthcheckInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    // Missing type
    expect(
      CliHealthcheckInputSchema.safeParse({ url: 'http://localhost:8080/health' }).success,
    ).toBe(false);

    // HTTP missing URL
    expect(CliHealthcheckInputSchema.safeParse({ type: 'http' }).success).toBe(false);
  });
});

describe('CliTargetInputSchema', () => {
  it('accepts config with mixed snake_case/camelCase properties', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent run {PROMPT}', // snake_case
      timeoutSeconds: 60, // camelCase
      keepTempFiles: true, // camelCase
      files_format: '--file {path}', // snake_case
    };

    const result = CliTargetInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command_template).toBe('agent run {PROMPT}');
    }
  });

  it('allows unknown properties (passthrough mode)', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent run {PROMPT}',
      custom_property: 'custom value',
      anotherUnknown: 123,
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(true);
  });

  it('accepts config with healthcheck', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent run {PROMPT}',
      healthcheck: {
        type: 'http' as const,
        url: 'http://localhost:8080/health',
      },
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing command_template and commandTemplate', () => {
    const input = { name: 'test-target', provider: 'cli' };

    const result = CliTargetInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('command_template');
    }
  });

  it('rejects non-cli provider', () => {
    const input = {
      name: 'test-target',
      provider: 'azure',
      command_template: 'agent run {PROMPT}',
    };

    expect(CliTargetInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing name', () => {
    const input = { provider: 'cli', command_template: 'agent run {PROMPT}' };
    expect(CliTargetInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('CliHealthcheckSchema (strict)', () => {
  it('accepts valid normalized HTTP and command healthchecks', () => {
    const httpInput = {
      type: 'http' as const,
      url: 'http://localhost:8080/health',
      timeoutMs: 30000,
    };
    expect(CliHealthcheckSchema.safeParse(httpInput).success).toBe(true);

    const commandInput = {
      type: 'command' as const,
      commandTemplate: 'curl http://localhost:8080/health',
      cwd: '/app',
      timeoutMs: 30000,
    };
    expect(CliHealthcheckSchema.safeParse(commandInput).success).toBe(true);

    // Without optional timeoutMs
    const minimalHttp = { type: 'http' as const, url: 'http://localhost:8080/health' };
    expect(CliHealthcheckSchema.safeParse(minimalHttp).success).toBe(true);
  });

  it('rejects unknown properties (strict mode)', () => {
    const input = {
      type: 'http' as const,
      url: 'http://localhost:8080/health',
      unknownProperty: 'value',
    };

    expect(CliHealthcheckSchema.safeParse(input).success).toBe(false);
  });

  it('rejects snake_case properties (expects camelCase only)', () => {
    const input = {
      type: 'http' as const,
      url: 'http://localhost:8080/health',
      timeout_seconds: 30,
    };

    expect(CliHealthcheckSchema.safeParse(input).success).toBe(false);
  });
});

describe('CliTargetConfigSchema (strict)', () => {
  it('accepts valid normalized config with all fields', () => {
    const input = {
      commandTemplate: 'agent run {PROMPT}',
      filesFormat: '--file {path}',
      cwd: '/app',
      timeoutMs: 60000,
      verbose: true,
      keepTempFiles: false,
      healthcheck: {
        type: 'http' as const,
        url: 'http://localhost:8080/health',
      },
    };

    expect(CliTargetConfigSchema.safeParse(input).success).toBe(true);

    // Minimal config
    expect(CliTargetConfigSchema.safeParse({ commandTemplate: 'agent run {PROMPT}' }).success).toBe(
      true,
    );
  });

  it('rejects unknown properties (strict mode)', () => {
    const input = { commandTemplate: 'agent run {PROMPT}', unknownField: 'value' };
    expect(CliTargetConfigSchema.safeParse(input).success).toBe(false);
  });

  it('rejects snake_case properties (expects camelCase only)', () => {
    const input = { command_template: 'agent run {PROMPT}' };
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
      type: 'http' as const,
      url: '${{ HEALTH_URL }}',
      timeout_seconds: 30,
    };

    const httpResult = normalizeCliHealthcheck(httpInput, mockEnv, 'test-target');
    expect(httpResult.type).toBe('http');
    if (httpResult.type === 'http') {
      expect(httpResult.url).toBe('http://resolved.example.com/health');
      expect(httpResult.timeoutMs).toBe(30000);
    }

    // Command with camelCase timeout
    const commandInput = {
      type: 'command' as const,
      commandTemplate: 'health-check.sh',
      timeoutSeconds: 5,
    };

    const commandResult = normalizeCliHealthcheck(commandInput, {}, 'test-target');
    expect(commandResult.type).toBe('command');
    if (commandResult.type === 'command') {
      expect(commandResult.commandTemplate).toBe('health-check.sh');
      expect(commandResult.timeoutMs).toBe(5000);
    }
  });

  it('throws when command healthcheck lacks command_template/commandTemplate', () => {
    const input = { type: 'command' as const, cwd: '/app' };

    expect(() => normalizeCliHealthcheck(input, {}, 'test-target')).toThrow(
      /command_template or commandTemplate is required/i,
    );
  });
});

describe('normalizeCliTargetInput', () => {
  const mockEnv = {
    CLI_CMD: 'custom-agent run {PROMPT}',
    WORK_DIR: '/custom/workdir',
    HEALTH_ENDPOINT: 'http://localhost:8080/health',
  };

  it('normalizes snake_case to camelCase with timeout conversion', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent run {PROMPT}',
      files_format: '--file {path}',
      timeout_seconds: 60,
      keep_temp_files: true,
      cli_verbose: true,
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.commandTemplate).toBe('agent run {PROMPT}');
    expect(result.filesFormat).toBe('--file {path}');
    expect(result.timeoutMs).toBe(60000);
    expect(result.keepTempFiles).toBe(true);
    expect(result.verbose).toBe(true);
  });

  it('prefers snake_case when both variants present', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'snake version',
      commandTemplate: 'camel version',
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.commandTemplate).toBe('snake version');
  });

  it('resolves environment variables in command template and cwd', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: '${{ CLI_CMD }}',
      cwd: '${{ WORK_DIR }}',
    };

    const result = normalizeCliTargetInput(input, mockEnv);

    expect(result.commandTemplate).toBe('custom-agent run {PROMPT}');
    expect(result.cwd).toBe('/custom/workdir');
  });

  it('handles fractional seconds correctly', () => {
    const input = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent {PROMPT}',
      timeout_seconds: 1.5,
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.timeoutMs).toBe(1500);
  });

  it('produces minimal output when only required fields provided', () => {
    const input = {
      name: 'minimal-target',
      provider: 'cli',
      commandTemplate: 'simple-agent {PROMPT}',
    };

    const result = normalizeCliTargetInput(input, {});

    expect(result.commandTemplate).toBe('simple-agent {PROMPT}');
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
      command_template: 'agent {PROMPT}',
      healthcheck: {
        type: 'http' as const,
        url: '${{ HEALTH_ENDPOINT }}',
        timeout_seconds: 10,
      },
    };

    const result = normalizeCliTargetInput(input, mockEnv);

    expect(result.healthcheck).toBeDefined();
    expect(result.healthcheck?.type).toBe('http');
    if (result.healthcheck?.type === 'http') {
      expect(result.healthcheck.url).toBe('http://localhost:8080/health');
      expect(result.healthcheck.timeoutMs).toBe(10000);
    }
  });

  it('accepts attachments_format/attachmentsFormat as alias for files_format', () => {
    // snake_case alias
    const snakeInput = {
      name: 'test-target',
      provider: 'cli',
      command_template: 'agent {PROMPT}',
      attachments_format: '--attach {path}',
    };
    expect(normalizeCliTargetInput(snakeInput, {}).filesFormat).toBe('--attach {path}');

    // camelCase alias
    const camelInput = {
      name: 'test-target',
      provider: 'cli',
      commandTemplate: 'agent {PROMPT}',
      attachmentsFormat: '--attach {path}',
    };
    expect(normalizeCliTargetInput(camelInput, {}).filesFormat).toBe('--attach {path}');
  });
});
