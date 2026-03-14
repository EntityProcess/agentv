import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDisplayName,
  generateShortDescription,
  initSkill,
  normalizeSkillName,
  parseInterfaceOverrides,
  writeOpenAIYaml,
} from '../skill-initializer.js';

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function createTmpDir(): string {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'skill-initializer-test-'));
  return tmpDir;
}

describe('normalizeSkillName', () => {
  it('returns lowercase hyphenated name unchanged', () => {
    expect(normalizeSkillName('my-skill')).toBe('my-skill');
  });

  it('converts spaces to hyphens', () => {
    expect(normalizeSkillName('my skill name')).toBe('my-skill-name');
  });

  it('collapses multiple hyphens', () => {
    expect(normalizeSkillName('my--skill---name')).toBe('my-skill-name');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeSkillName('-my-skill-')).toBe('my-skill');
  });

  it('lowercases uppercase letters', () => {
    expect(normalizeSkillName('MySkill')).toBe('myskill');
  });
});

describe('formatDisplayName', () => {
  it('capitalizes basic words', () => {
    expect(formatDisplayName('my-skill')).toBe('My Skill');
  });

  it('keeps acronyms uppercase', () => {
    expect(formatDisplayName('my-api-helper')).toBe('My API Helper');
  });

  it('applies brand casing', () => {
    expect(formatDisplayName('agentv-optimizer')).toBe('AgentV Optimizer');
  });

  it('lowercases small words (except first)', () => {
    expect(formatDisplayName('skills-for-the-team')).toBe('Skills for the Team');
  });
});

describe('generateShortDescription', () => {
  it('generates description from skill name', () => {
    const desc = generateShortDescription('my-skill');
    expect(desc).toContain('My Skill');
    expect(typeof desc).toBe('string');
  });
});

describe('parseInterfaceOverrides', () => {
  it('parses valid key=value overrides', () => {
    const result = parseInterfaceOverrides(['name=My Skill', 'description=A cool skill']);
    expect(result).not.toBeNull();
    expect(result?.overrides.name).toBe('My Skill');
    expect(result?.overrides.description).toBe('A cool skill');
  });

  it('returns null for override missing =', () => {
    const result = parseInterfaceOverrides(['invalid-override']);
    expect(result).toBeNull();
  });

  it('returns null for invalid key', () => {
    const result = parseInterfaceOverrides(['unknown-key=value']);
    expect(result).toBeNull();
  });
});

describe('writeOpenAIYaml', () => {
  it('creates agents/openai.yaml with correct content', () => {
    const dir = createTmpDir();
    const result = writeOpenAIYaml(dir, 'my-skill');

    expect(result).not.toBeNull();
    expect(existsSync(resolve(dir, 'agents', 'openai.yaml'))).toBe(true);

    const content = readFileSync(resolve(dir, 'agents', 'openai.yaml'), 'utf-8');
    expect(content).toContain('name:');
    expect(content).toContain('description:');
  });

  it('returns path to created file', () => {
    const dir = createTmpDir();
    const result = writeOpenAIYaml(dir, 'my-skill');

    expect(result).toBe(resolve(dir, 'agents', 'openai.yaml'));
  });

  it('applies interface overrides', () => {
    const dir = createTmpDir();
    const result = writeOpenAIYaml(dir, 'my-skill', {
      interfaceOverrides: ['name=Custom Name'],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(resolve(dir, 'agents', 'openai.yaml'), 'utf-8');
    expect(content).toContain('name: Custom Name');
  });
});

describe('initSkill', () => {
  it('creates skill directory with SKILL.md and agents/openai.yaml', () => {
    const dir = createTmpDir();
    const result = initSkill('my-skill', dir);

    expect(result).not.toBeNull();
    expect(existsSync(resolve(dir, 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(resolve(dir, 'my-skill', 'agents', 'openai.yaml'))).toBe(true);
  });

  it('creates resource directories with examples by default', () => {
    const dir = createTmpDir();
    initSkill('my-skill', dir);

    expect(existsSync(resolve(dir, 'my-skill', 'scripts'))).toBe(true);
    expect(existsSync(resolve(dir, 'my-skill', 'references'))).toBe(true);
    expect(existsSync(resolve(dir, 'my-skill', 'assets'))).toBe(true);
  });

  it('returns null if directory already exists', () => {
    const dir = createTmpDir();
    initSkill('my-skill', dir);
    const result = initSkill('my-skill', dir);

    expect(result).toBeNull();
  });

  it('respects resources option', () => {
    const dir = createTmpDir();
    initSkill('my-skill', dir, { resources: ['scripts'] });

    expect(existsSync(resolve(dir, 'my-skill', 'scripts'))).toBe(true);
    expect(existsSync(resolve(dir, 'my-skill', 'references'))).toBe(false);
    expect(existsSync(resolve(dir, 'my-skill', 'assets'))).toBe(false);
  });

  it('SKILL.md contains skill name in frontmatter', () => {
    const dir = createTmpDir();
    initSkill('my-test-skill', dir);

    const content = readFileSync(resolve(dir, 'my-test-skill', 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: my-test-skill');
  });
});
