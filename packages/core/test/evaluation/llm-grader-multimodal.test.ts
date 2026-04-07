/**
 * Tests for LLM grader multimodal support — auto-appending image content blocks
 * from agent output to the judge message.
 *
 * Verifies:
 * - Images from assistant messages are extracted and sent to the judge
 * - Text-only output is unchanged (backward compatible)
 * - Multiple images are all appended
 * - Images in non-assistant messages are ignored
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Message } from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

// ---------------------------------------------------------------------------
// Mock generateText to capture what the LLM grader sends to the judge.
// Must be set up before importing the module under test.
// ---------------------------------------------------------------------------

let capturedGenerateTextArgs: Record<string, unknown> | undefined;

function graderJsonResponse(score: number): string {
  return JSON.stringify({
    score,
    assertions: [{ text: 'Checked output', passed: score >= 0.5 }],
  });
}

mock.module('ai', () => {
  const actual = require('ai');
  return {
    ...actual,
    generateText: mock(async (args: Record<string, unknown>) => {
      capturedGenerateTextArgs = args;
      return {
        text: graderJsonResponse(0.85),
        usage: { inputTokens: 10, outputTokens: 20 },
        finishReason: 'stop',
        response: { id: 'test', timestamp: new Date(), modelId: 'test' },
      };
    }),
  };
});

// Import AFTER mock is set up
const { extractImageBlocks } = await import('../../src/evaluation/evaluators/llm-grader.js');
const { LlmGraderEvaluator } = await import('../../src/evaluation/evaluators.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const baseTestCase: EvalTest = {
  id: 'mm-case-1',
  suite: 'test-dataset',
  question: 'Describe the image',
  input: [{ role: 'user', content: 'What is in this image?' }],
  expected_output: [],
  reference_answer: 'A cat sitting on a mat',
  file_paths: [],
  criteria: 'Accurately describes image content',
  evaluator: 'llm-grader',
};

const baseTarget: ResolvedTarget = {
  kind: 'mock',
  name: 'mock',
  config: { response: '{}' },
};

/**
 * Creates a provider with a fake asLanguageModel() that returns a sentinel
 * object. The actual model behavior is handled by the mocked generateText.
 */
function createLmProvider() {
  const fakeModel = { modelId: 'test-model', provider: 'test' };
  return {
    id: 'test-lm',
    kind: 'mock' as const,
    targetName: 'test-lm',
    invoke: mock(async () => ({ output: [] })),
    asLanguageModel: () => fakeModel as never,
  };
}

// ---------------------------------------------------------------------------
// extractImageBlocks unit tests
// ---------------------------------------------------------------------------

describe('extractImageBlocks', () => {
  it('returns empty array when no messages', () => {
    expect(extractImageBlocks([])).toEqual([]);
  });

  it('returns empty array when messages have only string content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    expect(extractImageBlocks(messages)).toEqual([]);
  });

  it('extracts images from assistant messages with Content[] content', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the result' },
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,abc123' },
        ],
      },
    ];
    const images = extractImageBlocks(messages);
    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'data:image/png;base64,abc123',
    });
  });

  it('extracts multiple images across multiple assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'image', media_type: 'image/png', source: 'https://example.com/img1.png' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Another response' },
          { type: 'image', media_type: 'image/jpeg', source: 'data:image/jpeg;base64,xyz789' },
          { type: 'image', media_type: 'image/webp', source: 'https://example.com/img2.webp' },
        ],
      },
    ];
    const images = extractImageBlocks(messages);
    expect(images).toHaveLength(3);
    expect(images[0].source).toBe('https://example.com/img1.png');
    expect(images[1].source).toBe('data:image/jpeg;base64,xyz789');
    expect(images[2].source).toBe('https://example.com/img2.webp');
  });

  it('ignores images in non-assistant messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,user-img' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,asst-img' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,tool-img' },
        ],
      },
    ];
    const images = extractImageBlocks(messages);
    expect(images).toHaveLength(1);
    expect(images[0].source).toBe('data:image/png;base64,asst-img');
  });

  it('ignores file content blocks (only extracts images)', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Result' },
          { type: 'file', media_type: 'application/pdf', path: '/docs/doc.pdf' },
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,abc' },
        ],
      },
    ];
    const images = extractImageBlocks(messages);
    expect(images).toHaveLength(1);
    expect(images[0].type).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// LLM grader multimodal integration tests
// ---------------------------------------------------------------------------

describe('LlmGraderEvaluator multimodal', () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    capturedGenerateTextArgs = undefined;
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('sends plain text prompt when output has no images', async () => {
    const provider = createLmProvider();

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => provider,
    });

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'A cat on a mat',
      target: baseTarget,
      provider,
      attempt: 0,
      promptInputs: { question: 'Describe the image' },
      now: new Date(),
      output: [{ role: 'assistant', content: 'A cat on a mat' }],
    });

    expect(result.score).toBe(0.85);
    expect(capturedGenerateTextArgs).toBeDefined();

    // When no images, generateText should receive `prompt` (string), not `messages`
    expect(capturedGenerateTextArgs?.prompt).toBeTypeOf('string');
    expect(capturedGenerateTextArgs?.messages).toBeUndefined();
  });

  it('sends multi-part messages when output contains images', async () => {
    const provider = createLmProvider();

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => provider,
    });

    const outputMessages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is a cat' },
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,CATIMAGE' },
        ],
      },
    ];

    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Here is a cat',
      target: baseTarget,
      provider,
      attempt: 0,
      promptInputs: { question: 'Describe the image' },
      now: new Date(),
      output: outputMessages,
    });

    expect(result.score).toBe(0.85);
    expect(capturedGenerateTextArgs).toBeDefined();

    // When images exist, generateText should receive `messages` with multi-part content
    expect(capturedGenerateTextArgs?.messages).toBeDefined();
    expect(capturedGenerateTextArgs?.prompt).toBeUndefined();

    const messages = capturedGenerateTextArgs?.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');

    const content = messages[0].content as Array<Record<string, unknown>>;

    // Should contain text part + image part
    const textParts = content.filter((p) => p.type === 'text');
    const imageParts = content.filter((p) => p.type === 'image');

    expect(textParts.length).toBeGreaterThanOrEqual(1);
    expect(imageParts).toHaveLength(1);

    // Verify image data is passed through
    expect(imageParts[0].image).toBe('data:image/png;base64,CATIMAGE');
    expect(imageParts[0].mediaType).toBe('image/png');
  });

  it('appends multiple images from output', async () => {
    const provider = createLmProvider();

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => provider,
    });

    const outputMessages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Two images' },
          { type: 'image', media_type: 'image/png', source: 'https://example.com/img1.png' },
          { type: 'image', media_type: 'image/jpeg', source: 'data:image/jpeg;base64,IMG2DATA' },
        ],
      },
    ];

    await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Two images',
      target: baseTarget,
      provider,
      attempt: 0,
      promptInputs: { question: 'Describe the images' },
      now: new Date(),
      output: outputMessages,
    });

    expect(capturedGenerateTextArgs).toBeDefined();
    const messages = capturedGenerateTextArgs?.messages as Array<Record<string, unknown>>;
    const content = messages[0].content as Array<Record<string, unknown>>;

    const imageParts = content.filter((p) => p.type === 'image');
    expect(imageParts).toHaveLength(2);
    expect(imageParts[0].image).toBe('https://example.com/img1.png');
    expect(imageParts[1].image).toBe('data:image/jpeg;base64,IMG2DATA');
  });

  it('ignores images in user/tool messages (only assistant)', async () => {
    const provider = createLmProvider();

    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => provider,
    });

    const outputMessages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,USERIMG' },
        ],
      },
      {
        role: 'assistant',
        content: 'Just text, no images',
      },
    ];

    await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'Just text, no images',
      target: baseTarget,
      provider,
      attempt: 0,
      promptInputs: { question: 'Describe' },
      now: new Date(),
      output: outputMessages,
    });

    expect(capturedGenerateTextArgs).toBeDefined();

    // No images in assistant messages → should use plain prompt
    expect(capturedGenerateTextArgs?.prompt).toBeTypeOf('string');
    expect(capturedGenerateTextArgs?.messages).toBeUndefined();
  });

  it('injects preprocessed file text into the plain prompt', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentv-llm-file-'));
    const filePath = join(tempDir, 'report.xlsx');
    const scriptPath = join(tempDir, 'xlsx-to-text.js');
    await writeFile(filePath, 'unused', 'utf8');
    await writeFile(
      scriptPath,
      `const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log('spreadsheet:' + payload.original_path.split('/').pop());`,
      'utf8',
    );

    const provider = createLmProvider();
    const evaluator = new LlmGraderEvaluator({
      resolveGraderProvider: async () => provider,
    });

    await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: '',
      target: baseTarget,
      provider,
      attempt: 0,
      promptInputs: { question: 'Describe the image' },
      now: new Date(),
      evaluator: {
        name: 'grade',
        type: 'llm-grader',
        preprocessors: [{ type: 'xlsx', command: [process.execPath, scriptPath] }],
      },
      output: [
        {
          role: 'assistant',
          content: [
            {
              type: 'file',
              media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              path: filePath,
            },
          ],
        },
      ],
    });

    expect(capturedGenerateTextArgs?.prompt).toBeTypeOf('string');
    expect(String(capturedGenerateTextArgs?.prompt)).toContain('spreadsheet:report.xlsx');
  });
});
