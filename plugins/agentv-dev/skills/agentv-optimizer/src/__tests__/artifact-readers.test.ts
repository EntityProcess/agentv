import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readBenchmarkSummary } from '../artifact-readers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, '../../src/__fixtures__');

describe('artifact readers', () => {
  it('reads aggregate benchmark data from AgentV artifacts', () => {
    const fixturePath = join(FIXTURES_DIR, 'benchmark.json');
    expect(Object.keys(readBenchmarkSummary(fixturePath).targets).length).toBeGreaterThan(0);
  });
});
