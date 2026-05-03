/**
 * Tests for LLM grader multimodal support — auto-appending image content blocks
 * from agent output to the judge invocation.
 *
 * Verifies:
 * - Images from assistant messages are extracted and threaded through provider.invoke
 * - Text-only output is unchanged (backward compatible)
 * - Multiple images are all forwarded
 * - Images in non-assistant messages are ignored
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResolvedTarget } from '../../src/evaluation/providers/targets.js';
import type { Message, ProviderRequest } from '../../src/evaluation/providers/types.js';
import type { EvalTest } from '../../src/evaluation/types.js';

import { LlmGrader } from '../../src/evaluation/graders.js';
import { extractImageBlocks } from '../../src/evaluation/graders/llm-grader.js';

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

function graderJsonResponse(score: number): string {
  return JSON.stringify({
    score,
    assertions: [{ text: 'Checked output', passed: score >= 0.5 }],
  });
}

/**
 * Creates a provider whose invoke() returns a canned grader response and
 * records the request it was called with.
 */
function createCapturingProvider() {
  const captured: { request?: ProviderRequest } = {};
  return {
    captured,
    provider: {
      id: 'test-lm',
      kind: 'mock' as const,
      targetName: 'test-lm',
      invoke: mock(async (request: ProviderRequest) => {
        captured.request = request;
        return {
          output: [{ role: 'assistant' as const, content: graderJsonResponse(0.85) }],
          tokenUsage: { input: 10, output: 20 },
        };
      }),
    },
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

describe('LlmGrader multimodal', () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    // no-op; each test uses its own capturing provider
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('omits images when assistant output has none', async () => {
    const { captured, provider } = createCapturingProvider();

    const evaluator = new LlmGrader({
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
    expect(captured.request).toBeDefined();
    expect(captured.request?.images).toBeUndefined();
  });

  it('forwards images on the invoke request when assistant output contains them', async () => {
    const { captured, provider } = createCapturingProvider();

    const evaluator = new LlmGrader({
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
    expect(captured.request?.images).toHaveLength(1);
    expect(captured.request?.images?.[0]).toEqual({
      type: 'image',
      media_type: 'image/png',
      source: 'data:image/png;base64,CATIMAGE',
    });
  });

  it('forwards multiple images', async () => {
    const { captured, provider } = createCapturingProvider();

    const evaluator = new LlmGrader({
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

    expect(captured.request?.images).toHaveLength(2);
    expect(captured.request?.images?.[0].source).toBe('https://example.com/img1.png');
    expect(captured.request?.images?.[1].source).toBe('data:image/jpeg;base64,IMG2DATA');
  });

  it('ignores images in user/tool messages (only assistant)', async () => {
    const { captured, provider } = createCapturingProvider();

    const evaluator = new LlmGrader({
      resolveGraderProvider: async () => provider,
    });

    const outputMessages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'image', media_type: 'image/png', source: 'data:image/png;base64,USERIMG' },
        ],
      },
      { role: 'assistant', content: 'Just text, no images' },
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

    expect(captured.request?.images).toBeUndefined();
  });

  it('injects preprocessed file text into the user prompt', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentv-llm-file-'));
    const filePath = join(tempDir, 'report.xlsx');
    const scriptPath = join(tempDir, 'xlsx-to-text.js');
    await writeFile(filePath, 'unused', 'utf8');
    await writeFile(
      scriptPath,
      `const fs = require('node:fs');
const path = require('node:path');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log('spreadsheet:' + path.basename(payload.original_path));`,
      'utf8',
    );

    const { captured, provider } = createCapturingProvider();
    const evaluator = new LlmGrader({
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

    expect(captured.request?.question).toBeTypeOf('string');
    expect(String(captured.request?.question)).toContain('spreadsheet:report.xlsx');
  });
});
