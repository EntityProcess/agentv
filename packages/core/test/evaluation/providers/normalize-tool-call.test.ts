import { describe, expect, it } from 'vitest';
import { normalizeToolCall } from '../../../src/evaluation/providers/normalize-tool-call.js';
import type { ProviderKind } from '../../../src/evaluation/providers/types.js';
import type { ToolCall } from '../../../src/evaluation/providers/types.js';

function tc(tool: string, input?: Record<string, unknown>): ToolCall {
  return { tool, input };
}

describe('normalizeToolCall', () => {
  // -------------------------------------------------------------------------
  // Claude providers (already canonical — should be identity)
  // -------------------------------------------------------------------------
  describe('claude providers (identity)', () => {
    for (const provider of ['claude', 'claude-cli', 'claude-sdk'] as ProviderKind[]) {
      it(`${provider}: Skill → Skill`, () => {
        const result = normalizeToolCall(provider, tc('Skill', { skill: 'my-skill' }));
        expect(result.tool).toBe('Skill');
        expect((result.input as Record<string, unknown>).skill).toBe('my-skill');
      });

      it(`${provider}: Read → Read`, () => {
        const result = normalizeToolCall(provider, tc('Read', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Read');
        expect((result.input as Record<string, unknown>).file_path).toBe('/foo.ts');
      });

      it(`${provider}: Write → Write`, () => {
        const result = normalizeToolCall(provider, tc('Write', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Write');
      });

      it(`${provider}: Edit → Edit`, () => {
        const result = normalizeToolCall(provider, tc('Edit', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Edit');
      });

      it(`${provider}: Bash → Bash`, () => {
        const result = normalizeToolCall(provider, tc('Bash', { command: 'ls' }));
        expect(result.tool).toBe('Bash');
      });
    }
  });

  // -------------------------------------------------------------------------
  // Copilot providers
  // -------------------------------------------------------------------------
  describe('copilot providers', () => {
    for (const provider of [
      'copilot-cli',
      'copilot-sdk',
      'copilot-log',
      'vscode',
      'vscode-insiders',
    ] as ProviderKind[]) {
      it(`${provider}: skill (lowercase) → Skill`, () => {
        const result = normalizeToolCall(provider, tc('skill', { skill: 'my-skill' }));
        expect(result.tool).toBe('Skill');
      });

      it(`${provider}: Read File → Read`, () => {
        const result = normalizeToolCall(provider, tc('Read File', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Read');
      });

      it(`${provider}: readFile → Read`, () => {
        const result = normalizeToolCall(provider, tc('readFile', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Read');
      });

      it(`${provider}: readTextFile → Read`, () => {
        const result = normalizeToolCall(provider, tc('readTextFile', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Read');
      });

      it(`${provider}: writeTextFile → Write`, () => {
        const result = normalizeToolCall(provider, tc('writeTextFile', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Write');
      });

      it(`${provider}: Write File → Write`, () => {
        const result = normalizeToolCall(provider, tc('Write File', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Write');
      });

      it(`${provider}: editFile → Edit`, () => {
        const result = normalizeToolCall(provider, tc('editFile', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Edit');
      });

      it(`${provider}: Edit File → Edit`, () => {
        const result = normalizeToolCall(provider, tc('Edit File', { file_path: '/foo.ts' }));
        expect(result.tool).toBe('Edit');
      });

      it(`${provider}: runTerminalCommand → Bash`, () => {
        const result = normalizeToolCall(provider, tc('runTerminalCommand', { command: 'ls' }));
        expect(result.tool).toBe('Bash');
      });

      it(`${provider}: "Using skill: X" prefix → Skill with extracted name`, () => {
        const result = normalizeToolCall(provider, tc('Using skill: my-skill', {}));
        expect(result.tool).toBe('Skill');
        expect((result.input as Record<string, unknown>).skill).toBe('my-skill');
      });

      it(`${provider}: "Viewing X" prefix → Read`, () => {
        const result = normalizeToolCall(provider, tc('Viewing /foo/bar.ts', {}));
        expect(result.tool).toBe('Read');
      });
    }
  });

  // -------------------------------------------------------------------------
  // Codex
  // -------------------------------------------------------------------------
  describe('codex', () => {
    it('command_execution → Bash', () => {
      const result = normalizeToolCall('codex', tc('command_execution', { command: 'cat file' }));
      expect(result.tool).toBe('Bash');
    });

    it('file_change → Edit', () => {
      const result = normalizeToolCall('codex', tc('file_change', { changes: [] }));
      expect(result.tool).toBe('Edit');
    });

    it('"mcp:server/skill-name" prefix → Skill with extracted name', () => {
      const result = normalizeToolCall('codex', tc('mcp:my-server/my-skill', {}));
      expect(result.tool).toBe('Skill');
      expect((result.input as Record<string, unknown>).skill).toBe('my-server/my-skill');
    });
  });

  // -------------------------------------------------------------------------
  // Pi
  // -------------------------------------------------------------------------
  describe('pi providers', () => {
    for (const provider of ['pi-coding-agent', 'pi-cli'] as ProviderKind[]) {
      it(`${provider}: read → Read`, () => {
        const result = normalizeToolCall(provider, tc('read', { path: '/foo.ts' }));
        expect(result.tool).toBe('Read');
      });

      it(`${provider}: read normalizes path → file_path`, () => {
        const result = normalizeToolCall(provider, tc('read', { path: '/foo.ts' }));
        expect((result.input as Record<string, unknown>).file_path).toBe('/foo.ts');
      });
    }
  });

  // -------------------------------------------------------------------------
  // Input field normalization
  // -------------------------------------------------------------------------
  describe('input field normalization', () => {
    it('Read: copies path → file_path when file_path missing', () => {
      const result = normalizeToolCall('claude', tc('Read', { path: '/foo.ts' }));
      expect((result.input as Record<string, unknown>).file_path).toBe('/foo.ts');
      expect((result.input as Record<string, unknown>).path).toBe('/foo.ts');
    });

    it('Read: copies filePath → file_path when file_path missing', () => {
      const result = normalizeToolCall('copilot-cli', tc('Read', { filePath: '/bar.ts' }));
      expect((result.input as Record<string, unknown>).file_path).toBe('/bar.ts');
    });

    it('Read: does not overwrite existing file_path', () => {
      const result = normalizeToolCall(
        'claude',
        tc('Read', { file_path: '/original.ts', path: '/other.ts' }),
      );
      expect((result.input as Record<string, unknown>).file_path).toBe('/original.ts');
    });
  });

  // -------------------------------------------------------------------------
  // Pass-through for unknown tools
  // -------------------------------------------------------------------------
  describe('pass-through', () => {
    it('unknown tool name passes through unchanged', () => {
      const original = tc('custom_search', { query: 'foo' });
      const result = normalizeToolCall('copilot-cli', original);
      expect(result.tool).toBe('custom_search');
      expect(result.input).toEqual({ query: 'foo' });
    });

    it('unknown provider passes through unchanged', () => {
      const original = tc('Read File', { file_path: '/foo.ts' });
      const result = normalizeToolCall('openai' as ProviderKind, original);
      expect(result.tool).toBe('Read File');
    });
  });

  // -------------------------------------------------------------------------
  // Preserves other ToolCall fields
  // -------------------------------------------------------------------------
  describe('preserves ToolCall metadata', () => {
    it('preserves id, startTime, endTime, durationMs, output', () => {
      const original: ToolCall = {
        tool: 'readFile',
        input: { file_path: '/foo.ts' },
        output: 'file contents',
        id: 'tc-123',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T00:00:01Z',
        durationMs: 1000,
      };
      const result = normalizeToolCall('copilot-cli', original);
      expect(result.tool).toBe('Read');
      expect(result.output).toBe('file contents');
      expect(result.id).toBe('tc-123');
      expect(result.startTime).toBe('2024-01-01T00:00:00Z');
      expect(result.endTime).toBe('2024-01-01T00:00:01Z');
      expect(result.durationMs).toBe(1000);
    });
  });
});
