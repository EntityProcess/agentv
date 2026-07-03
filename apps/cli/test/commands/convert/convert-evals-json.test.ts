import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convertEvalsJsonToYaml } from '../../../src/commands/convert/index.js';
import {
  agentSkillsToAgentVYamlObject,
  readAgentSkillsEvalsFile,
} from '../../../src/commands/read-adapters/agent-skills-evals.js';

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
          expectations: ['Check C'],
        },
      ],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('Converted from Agent Skills evals.json');
    expect(yaml).toContain('description: "Evals for test-skill skill"');
    expect(yaml).toContain('tags:');
    expect(yaml).toContain('skill: "test-skill"');
    expect(yaml).toContain('source_adapter: "agent-skills-evals-json"');
    expect(yaml).not.toContain('agent_skills_skill_name');
    expect(yaml).toContain('id: "1"');
    expect(yaml).toContain('input: "Do something"');
    expect(yaml).toContain('Do something');
    expect(yaml).toContain('criteria: |-');
    expect(yaml).toContain('Something done');
    expect(yaml).toContain('agent-skills-criteria');
    expect(yaml).toContain('assert:');
    expect(yaml).toContain('metric: agent-skills-criteria');
    expect(yaml).toContain('type: llm-rubric');
    expect(yaml).toContain('value:');
    expect(yaml).toContain('expected-outcome');
    expect(yaml).toContain('assertion-1');
    expect(yaml).toContain('expectation-1');
    expect(yaml).toContain('Check A');
    expect(yaml).toContain('Check B');
    expect(yaml).toContain('Check C');
    expect(yaml).not.toContain('expected_output:');
  });

  it('handles evals without assertions or expected_output', () => {
    const filePath = writeTempJson({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'Just a prompt' }],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('id: "1"');
    expect(yaml).toContain('Just a prompt');
    expect(yaml).not.toContain('assert:');
    expect(yaml).not.toContain('expected_output:');
  });

  it('maps files to input_files', () => {
    const filePath = writeTempJson({
      skill_name: 'test-skill',
      evals: [
        {
          id: 1,
          prompt: 'Analyze data',
          files: ['data/input.csv'],
        },
      ],
    });

    const yaml = convertEvalsJsonToYaml(filePath);
    expect(yaml).toContain('input_files:');
    expect(yaml).toContain('data/input.csv');
  });

  it('maps skill_name to tags.skill in the read adapter', () => {
    const filePath = writeTempJson({
      skill_name: 'test-skill',
      evals: [{ id: 1, prompt: 'Just a prompt', assertions: ['Check A'] }],
    });

    const yamlObject = agentSkillsToAgentVYamlObject(readAgentSkillsEvalsFile(filePath));

    expect(yamlObject.tags).toEqual({ skill: 'test-skill' });
    expect(yamlObject.metadata).toEqual({ source_adapter: 'agent-skills-evals-json' });
    expect(yamlObject.tests?.[0]?.assert?.[0]).toMatchObject({
      metric: 'agent-skills-criteria',
      type: 'llm-rubric',
      value: [{ id: 'assertion-1', outcome: 'Check A' }],
    });
  });

  it('accepts expectations as Agent Skills criteria without assertions', () => {
    const filePath = writeTempJson({
      skill_name: 'test-skill',
      evals: [
        {
          id: 1,
          prompt: 'Check this paragraph for style issues',
          expectations: ['Flags "please" as unnecessary', 'Flags "below" as positional'],
        },
      ],
    });

    const yamlObject = agentSkillsToAgentVYamlObject(readAgentSkillsEvalsFile(filePath));

    expect(yamlObject.tests?.[0]?.assert?.[0]).toMatchObject({
      metric: 'agent-skills-criteria',
      type: 'llm-rubric',
      value: [
        {
          id: 'expectation-1',
          outcome: 'Flags "please" as unnecessary',
          required: true,
        },
        {
          id: 'expectation-2',
          outcome: 'Flags "below" as positional',
          required: true,
        },
      ],
    });
  });

  it('throws on invalid format', () => {
    const filePath = writeTempJson({ not_evals: true });
    expect(() => convertEvalsJsonToYaml(filePath)).toThrow(
      "top-level 'skill_name' string and 'evals' array",
    );
  });
});
