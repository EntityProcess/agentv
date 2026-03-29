import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  detectImageMediaType,
  processMessages,
} from '../../../src/evaluation/loaders/message-processor.js';
import type { TestMessage } from '../../../src/evaluation/types.js';

// Minimal 1x1 red PNG (68 bytes)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const FIXTURE_DIR = path.join(import.meta.dirname, '__fixtures__');
const PNG_PATH = path.join(FIXTURE_DIR, 'test-image.png');
const JPG_PATH = path.join(FIXTURE_DIR, 'test-image.jpg');
const TXT_PATH = path.join(FIXTURE_DIR, 'test-file.txt');

// Setup & teardown
async function setupFixtures() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(PNG_PATH, Buffer.from(TINY_PNG_BASE64, 'base64'));
  await writeFile(JPG_PATH, Buffer.from(TINY_PNG_BASE64, 'base64'));
  await writeFile(TXT_PATH, 'hello world');
}

async function cleanupFixtures() {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// detectImageMediaType
// ---------------------------------------------------------------------------

describe('detectImageMediaType', () => {
  it('detects PNG', () => {
    expect(detectImageMediaType('photo.png')).toBe('image/png');
  });

  it('detects JPG', () => {
    expect(detectImageMediaType('photo.jpg')).toBe('image/jpeg');
  });

  it('detects JPEG', () => {
    expect(detectImageMediaType('photo.jpeg')).toBe('image/jpeg');
  });

  it('detects GIF', () => {
    expect(detectImageMediaType('anim.gif')).toBe('image/gif');
  });

  it('detects WebP', () => {
    expect(detectImageMediaType('modern.webp')).toBe('image/webp');
  });

  it('detects SVG', () => {
    expect(detectImageMediaType('icon.svg')).toBe('image/svg+xml');
  });

  it('detects BMP', () => {
    expect(detectImageMediaType('old.bmp')).toBe('image/bmp');
  });

  it('is case-insensitive', () => {
    expect(detectImageMediaType('PHOTO.PNG')).toBe('image/png');
    expect(detectImageMediaType('Photo.JPG')).toBe('image/jpeg');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(detectImageMediaType('file.txt')).toBeUndefined();
    expect(detectImageMediaType('file.pdf')).toBeUndefined();
    expect(detectImageMediaType('file')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// processMessages – type: 'image'
// ---------------------------------------------------------------------------

describe('processMessages – image content', () => {
  it('reads a PNG file and produces a ContentImage with base64 data URI', async () => {
    await setupFixtures();
    try {
      const messages: TestMessage[] = [
        {
          role: 'user',
          content: [{ type: 'image', value: './test-image.png' }],
        },
      ];

      const result = await processMessages({
        messages,
        searchRoots: [FIXTURE_DIR],
        repoRootPath: FIXTURE_DIR,
        messageType: 'input',
        verbose: false,
      });

      expect(result).toHaveLength(1);
      const content = result[0].content;
      expect(Array.isArray(content)).toBe(true);
      const items = content as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('image');
      expect(items[0].media_type).toBe('image/png');
      expect(typeof items[0].source).toBe('string');
      expect((items[0].source as string).startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      await cleanupFixtures();
    }
  });

  it('reads a JPG file and detects correct media type', async () => {
    await setupFixtures();
    try {
      const messages: TestMessage[] = [
        {
          role: 'user',
          content: [{ type: 'image', value: './test-image.jpg' }],
        },
      ];

      const result = await processMessages({
        messages,
        searchRoots: [FIXTURE_DIR],
        repoRootPath: FIXTURE_DIR,
        messageType: 'input',
        verbose: false,
      });

      const items = result[0].content as Record<string, unknown>[];
      expect(items[0].media_type).toBe('image/jpeg');
      expect((items[0].source as string).startsWith('data:image/jpeg;base64,')).toBe(true);
    } finally {
      await cleanupFixtures();
    }
  });

  it('warns and skips when image file does not exist', async () => {
    await setupFixtures();
    try {
      const messages: TestMessage[] = [
        {
          role: 'user',
          content: [{ type: 'image', value: './nonexistent.png' }],
        },
      ];

      const result = await processMessages({
        messages,
        searchRoots: [FIXTURE_DIR],
        repoRootPath: FIXTURE_DIR,
        messageType: 'input',
        verbose: false,
      });

      const content = result[0].content as Record<string, unknown>[];
      expect(content).toHaveLength(0);
    } finally {
      await cleanupFixtures();
    }
  });

  it('preserves existing type: text and type: file behavior', async () => {
    await setupFixtures();
    try {
      const messages: TestMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', value: 'describe this' },
            { type: 'file', value: './test-file.txt' },
            { type: 'image', value: './test-image.png' },
          ],
        },
      ];

      const result = await processMessages({
        messages,
        searchRoots: [FIXTURE_DIR],
        repoRootPath: FIXTURE_DIR,
        messageType: 'input',
        verbose: false,
      });

      const items = result[0].content as Record<string, unknown>[];
      expect(items).toHaveLength(3);
      // text preserved
      expect(items[0].type).toBe('text');
      expect(items[0].value).toBe('describe this');
      // file preserved with resolved content
      expect(items[1].type).toBe('file');
      expect(items[1].text).toBe('hello world');
      // image has base64
      expect(items[2].type).toBe('image');
      expect(items[2].media_type).toBe('image/png');
    } finally {
      await cleanupFixtures();
    }
  });
});
