import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  containsTemplateVariables,
  resolveCustomPrompt,
} from '../../../src/evaluation/graders/prompt-resolution.js';
import { buildTraceFromMessages } from '../../../src/evaluation/trace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it('returns true for structured template variables', () => {
    expect(
      containsTemplateVariables(
        'Review {{metadata_json}} and {{rubrics_json}} against {{input}} and {{output}}',
      ),
    ).toBe(true);
  });

  it('returns false for removed deprecated _text variables', () => {
    expect(containsTemplateVariables('Grade the {{output_text}}')).toBe(false);
    expect(containsTemplateVariables('Evaluate {{input_text}}')).toBe(false);
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

  it('passes final answer as output and transcript through messages/trace to executable prompts', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'prompt-template-contract-'));
    const promptPath = path.join(tmpDir, 'prompt-template.ts');
    const promptTemplateRuntime = pathToFileURL(
      path.resolve(__dirname, '../../../../eval/src/prompt-template.ts'),
    ).href;

    writeFileSync(
      promptPath,
      `import { definePromptTemplate } from ${JSON.stringify(promptTemplateRuntime)};

definePromptTemplate((ctx) => {
  if (typeof ctx.output !== 'string') {
    throw new Error('expected output to be the final answer string');
  }
  if (ctx.output !== 'Final answer') {
    throw new Error('unexpected final answer: ' + ctx.output);
  }
  if (!Array.isArray(ctx.messages) || ctx.messages.length < 2) {
    throw new Error('expected transcript messages');
  }
  if (!ctx.messages.some((message) => message.role === 'assistant' && message.content === 'Trace assistant turn')) {
    throw new Error('expected transcript message from trace');
  }
  if (!ctx.trace || !Array.isArray(ctx.trace.messages) || ctx.trace.messages.length !== ctx.messages.length) {
    throw new Error('expected full trace with transcript messages');
  }

  return \`Final: \${ctx.output}; messages: \${ctx.messages.length}; trace: \${ctx.trace.messages.length}\`;
});
`,
    );

    const trace = buildTraceFromMessages({
      input: [{ role: 'user', content: 'Question?' }],
      output: [{ role: 'assistant', content: 'Trace assistant turn' }],
      finalOutput: 'Final answer',
      target: 'mock',
      testId: 'prompt-contract',
    });

    const result = await resolveCustomPrompt(
      {
        resolvedPromptScript: [process.execPath, 'run', promptPath],
      },
      {
        evalCase: {
          id: 'prompt-contract',
          input: [{ role: 'user', content: 'Question?' }],
          expected_output: [{ role: 'assistant', content: 'Expected answer' }],
          file_paths: [],
          criteria: 'Check final answer.',
        },
        candidate: 'Final answer',
        output: [{ role: 'assistant', content: 'Legacy transcript fallback' }],
        trace,
      },
      5_000,
    );

    expect(result).toBe('Final: Final answer; messages: 2; trace: 2');
  });
});
