import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendPreprocessingWarnings,
  extractTextWithPreprocessors,
  normalizePreprocessorType,
} from '../../src/evaluation/content-preprocessor.js';

describe('content preprocessors', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('reads text files as UTF-8 by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentv-preprocessor-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'report.txt');
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8');

    const result = await extractTextWithPreprocessors(
      [{ type: 'file', media_type: 'text/plain', path: filePath }],
      undefined,
    );

    expect(result.warnings).toEqual([]);
    expect(result.text).toContain('[[ file:');
    expect(result.text).toContain('alpha\nbeta');
  });

  it('uses configured preprocessors for matching file types', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentv-preprocessor-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'report.xlsx');
    const scriptPath = join(dir, 'xlsx-to-text.js');
    await writeFile(filePath, 'unused', 'utf8');
    await writeFile(
      scriptPath,
      `const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log('sheet:' + payload.original_path.split('/').pop());`,
      'utf8',
    );

    const result = await extractTextWithPreprocessors(
      [
        {
          type: 'file',
          media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          path: filePath,
        },
      ],
      [{ type: 'xlsx', command: [process.execPath, scriptPath] }],
    );

    expect(result.warnings).toEqual([]);
    expect(result.text).toContain('sheet:report.xlsx');
  });

  it('records a warning when default UTF-8 extraction looks binary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentv-preprocessor-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'report.pdf');
    await writeFile(filePath, Buffer.from([0, 159, 146, 150]));

    const result = await extractTextWithPreprocessors(
      [{ type: 'file', media_type: 'application/pdf', path: filePath }],
      undefined,
    );

    expect(result.text).toBe('');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.reason).toContain('configure a preprocessor');
  });

  it('appends warnings to extracted text for grader prompts', () => {
    const text = appendPreprocessingWarnings('body', [
      { file: '/tmp/report.pdf', mediaType: 'application/pdf', reason: 'failed to extract' },
    ]);
    expect(text).toContain('body');
    expect(text).toContain('[file preprocessing warning]');
  });

  it('normalizes short aliases to MIME types', () => {
    expect(normalizePreprocessorType('xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(normalizePreprocessorType('text/html')).toBe('text/html');
  });
});
