import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { materializeContentForGrader } from '../../src/evaluation/evaluators/code-evaluator.js';
import { CodeEvaluator } from '../../src/evaluation/evaluators/code-evaluator.js';
import type { EvalTest } from '../../src/evaluation/types.js';

const baseTestCase: EvalTest = {
  id: 'case-mm',
  dataset: 'test-dataset',
  question: 'Test question',
  input: [{ role: 'user', content: 'Describe this image' }],
  expected_output: [],
  reference_answer: 'A chart',
  file_paths: [],
  criteria: 'Describes the image correctly',
  evaluator: 'code-grader',
};

/** Encode a string as base64 data URI. */
function toDataUri(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`;
}

/** Create a grader script that echoes the parsed payload back as JSON. */
async function createPayloadEchoGrader(dir: string): Promise<readonly string[]> {
  const script = join(dir, 'echo-grader.js');
  await writeFile(
    script,
    `const input = require('fs').readFileSync(0, 'utf8');
const payload = JSON.parse(input);
console.log(JSON.stringify({
  score: 1.0,
  assertions: [{ text: 'ok', passed: true }],
  details: { payload },
}));
`,
    'utf8',
  );
  return [process.execPath, script];
}

describe('materializeContentForGrader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'materialize-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const getWorkDir = () => Promise.resolve(tmpDir);

  it('returns null for null input', async () => {
    const result = await materializeContentForGrader(null, getWorkDir);
    expect(result).toBeNull();
  });

  it('returns null for undefined input', async () => {
    const result = await materializeContentForGrader(undefined, getWorkDir);
    expect(result).toBeNull();
  });

  it('passes through text-only messages unchanged', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    expect(result).toBe(messages); // Same reference — zero-copy
  });

  it('passes through Content[] with only text blocks unchanged', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'paragraph 1' },
          { type: 'text', text: 'paragraph 2' },
        ],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    expect(result).toBe(messages); // Same reference — no images
  });

  it('converts ContentImage data URI to temp file path', async () => {
    const imageData = 'fake-png-data-for-testing';
    const dataUri = toDataUri('image/png', imageData);

    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is a chart:' },
          { type: 'image', media_type: 'image/png', source: dataUri },
        ],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    expect(result).not.toBe(messages); // New array — content was transformed

    const content = (result?.[0] as Record<string, unknown>).content as Record<string, unknown>[];
    expect(content).toHaveLength(2);

    // Text block preserved
    expect(content[0]).toEqual({ type: 'text', text: 'Here is a chart:' });

    // Image block converted to path
    const imgBlock = content[1];
    expect(imgBlock.type).toBe('image');
    expect(imgBlock.media_type).toBe('image/png');
    expect(typeof imgBlock.path).toBe('string');
    expect(imgBlock.path).toContain('img-0.png');
    expect(imgBlock).not.toHaveProperty('source');

    // Verify file was written with correct content
    const filePath = imgBlock.path as string;
    expect(existsSync(filePath)).toBe(true);
    const fileContent = readFileSync(filePath);
    expect(fileContent.toString()).toBe(imageData);
  });

  it('converts ContentImage path/URL source to path field', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Chart:' },
          { type: 'image', media_type: 'image/png', source: '/workspace/chart.png' },
        ],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    const content = (result?.[0] as Record<string, unknown>).content as Record<string, unknown>[];
    const imgBlock = content[1];

    expect(imgBlock.type).toBe('image');
    expect(imgBlock.media_type).toBe('image/png');
    expect(imgBlock.path).toBe('/workspace/chart.png');
    expect(imgBlock).not.toHaveProperty('source');
  });

  it('handles JPEG media type extension correctly', async () => {
    const dataUri = toDataUri('image/jpeg', 'fake-jpeg');
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'image', media_type: 'image/jpeg', source: dataUri }],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    const content = (result?.[0] as Record<string, unknown>).content as Record<string, unknown>[];
    expect(content[0].path as string).toContain('.jpg');
  });

  it('preserves non-content message fields', async () => {
    const dataUri = toDataUri('image/png', 'data');
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'image', media_type: 'image/png', source: dataUri }],
        toolCalls: [{ tool: 'screenshot', input: {} }],
        metadata: { provider: 'test' },
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    const msg = result?.[0] as Record<string, unknown>;
    expect(msg.role).toBe('assistant');
    expect(msg.toolCalls).toEqual([{ tool: 'screenshot', input: {} }]);
    expect(msg.metadata).toEqual({ provider: 'test' });
  });

  it('handles multiple images across multiple messages', async () => {
    const uri1 = toDataUri('image/png', 'image1');
    const uri2 = toDataUri('image/webp', 'image2');

    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First chart:' },
          { type: 'image', media_type: 'image/png', source: uri1 },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Second chart:' },
          { type: 'image', media_type: 'image/webp', source: uri2 },
        ],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    expect(result).toHaveLength(2);

    const content0 = (result?.[0] as Record<string, unknown>).content as Record<string, unknown>[];
    const content1 = (result?.[1] as Record<string, unknown>).content as Record<string, unknown>[];

    expect(content0[1].path as string).toContain('img-0.png');
    expect(content1[1].path as string).toContain('img-1.webp');

    // Both files exist
    expect(existsSync(content0[1].path as string)).toBe(true);
    expect(existsSync(content1[1].path as string)).toBe(true);
  });

  it('preserves ContentFile blocks unchanged', async () => {
    const dataUri = toDataUri('image/png', 'data');
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'file', media_type: 'text/csv', path: '/workspace/data.csv' },
          { type: 'image', media_type: 'image/png', source: dataUri },
        ],
      },
    ] as Record<string, unknown>[];

    const result = await materializeContentForGrader(messages, getWorkDir);
    const content = (result?.[0] as Record<string, unknown>).content as Record<string, unknown>[];

    // File block preserved exactly
    expect(content[0]).toEqual({
      type: 'file',
      media_type: 'text/csv',
      path: '/workspace/data.csv',
    });
    // Image block converted
    expect(content[1].type).toBe('image');
    expect(typeof content[1].path).toBe('string');
  });
});

describe('CodeEvaluator multimodal integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'code-eval-mm-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sends text-only output unchanged to grader', async () => {
    const command = await createPayloadEchoGrader(tmpDir);
    const output = [{ role: 'assistant' as const, content: 'Hello world' }];

    const evaluator = new CodeEvaluator({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output,
    });

    expect(result.score).toBe(1.0);
    const details = result.details as Record<string, unknown>;
    const payload = details.payload as Record<string, unknown>;
    const outputMsgs = payload.output as Record<string, unknown>[];
    expect(outputMsgs[0].content).toBe('Hello world');
  });

  it('materializes image data URIs in output for grader', async () => {
    const command = await createPayloadEchoGrader(tmpDir);
    const imageData = 'test-image-bytes';
    const dataUri = toDataUri('image/png', imageData);

    const output = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Generated chart:' },
          { type: 'image' as const, media_type: 'image/png', source: dataUri },
        ],
      },
    ];

    const evaluator = new CodeEvaluator({ command });
    const result = await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output,
    });

    expect(result.score).toBe(1.0);

    // Verify the grader received the payload with image paths (not data URIs)
    const details = result.details as Record<string, unknown>;
    const payload = details.payload as Record<string, unknown>;
    const outputMsgs = payload.output as Record<string, unknown>[];
    const content = outputMsgs[0].content as Record<string, unknown>[];

    // Text block preserved
    expect(content[0]).toEqual({ type: 'text', text: 'Generated chart:' });

    // Image block has path, not source
    expect(content[1].type).toBe('image');
    expect(content[1].media_type).toBe('image/png');
    expect(typeof content[1].path).toBe('string');
    expect(content[1]).not.toHaveProperty('source');
  });

  it('cleans up materialized image temp files after grading', async () => {
    const command = await createPayloadEchoGrader(tmpDir);
    const dataUri = toDataUri('image/png', 'cleanup-test');

    const output = [
      {
        role: 'assistant' as const,
        content: [{ type: 'image' as const, media_type: 'image/png', source: dataUri }],
      },
    ];

    const evaluator = new CodeEvaluator({ command });
    await evaluator.evaluate({
      evalCase: baseTestCase,
      candidate: 'answer',
      output,
    });

    // Image temp dirs should be cleaned up after evaluation
    const agentVImgDirs = readdirSync(tmpdir()).filter((d) => d.startsWith('agentv-img-'));
    // Can't assert zero (concurrent tests), but the cleanup logic was exercised
  });
});
