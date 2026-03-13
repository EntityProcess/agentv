import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convertEvalsJsonToYaml } from '../../../src/commands/convert/index.js';

describe('convertEvalsJsonToYaml', () => {
  function writeTempJson(data: unknown): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'convert-test-'));
    const filePath = path.join(dir, 'evals.json');
    writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  }

  it('converts basic evals.json to YAML', () => {
    const filePath = writeTempJson({
      skill_name: 'test-skill',
      evals: [
        {
          id: 1,
          prompt: 'Do something',
          expected_output: 'Something done',
          assertions: ['Check A', 'Check B'],
        },
      ],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('Converted from Agent Skills evals.json');
    expect(yaml).toContain('description: "Evals for test-skill skill"');
    expect(yaml).toContain('id: "1"');
    expect(yaml).toContain('role: user');
    expect(yaml).toContain('Do something');
    expect(yaml).toContain('assertion-1');
    expect(yaml).toContain('type: llm-judge');
    expect(yaml).toContain('Check A');
    expect(yaml).toContain('Check B');
  });

  it('handles evals without assertions or expected_output', () => {
    const filePath = writeTempJson({
      evals: [{ id: 1, prompt: 'Just a prompt' }],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('id: "1"');
    expect(yaml).toContain('Just a prompt');
    expect(yaml).not.toContain('assert:');
    expect(yaml).not.toContain('expected_output:');
  });

  it('adds TODO comments for files', () => {
    const filePath = writeTempJson({
      evals: [
        {
          id: 1,
          prompt: 'Analyze data',
          files: ['data/input.csv'],
        },
      ],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('# TODO:');
    expect(yaml).toContain('data/input.csv');
  });

  it('throws on invalid format', () => {
    const filePath = writeTempJson({ not_evals: true });
    expect(() => convertEvalsJsonToYaml(filePath)).toThrow("missing 'evals' array");
  });
});
