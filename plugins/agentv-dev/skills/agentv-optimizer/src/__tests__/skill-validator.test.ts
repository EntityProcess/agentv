import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateSkill } from '../skill-validator.js';

let tmpDir: string;

function createTmpDir(): string {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'skill-validator-test-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeSkillMd(dir: string, content: string) {
  writeFileSync(resolve(dir, 'SKILL.md'), content, 'utf-8');
}

describe('validateSkill', () => {
  it('valid skill with agents/openai.yaml returns valid=true', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my-skill\ndescription: A great skill\n---\n\n# Content');
    mkdirSync(resolve(dir, 'agents'), { recursive: true });
    writeFileSync(resolve(dir, 'agents', 'openai.yaml'), 'name: my-skill\n', 'utf-8');

    const result = validateSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Skill is valid!');
  });

  it('valid skill without agents/openai.yaml returns valid=true with warning', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my-skill\ndescription: A great skill\n---\n\n# Content');

    const result = validateSkill(dir);
    expect(result.valid).toBe(true);
    expect(result.message).toContain('Warning: agents/openai.yaml not found');
  });

  it('missing SKILL.md returns valid=false', () => {
    const dir = createTmpDir();

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toBe('SKILL.md not found');
  });

  it('SKILL.md without frontmatter returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '# Just a heading\n\nNo frontmatter here.');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toBe('No YAML frontmatter found');
  });

  it('invalid frontmatter format returns valid=false', () => {
    const dir = createTmpDir();
    // Only opening --- but no closing ---
    writeSkillMd(dir, '---\nname: my-skill\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toBe('Invalid frontmatter format');
  });

  it('unexpected keys in frontmatter returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my-skill\ndescription: desc\nunknown-key: value\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Unexpected key(s)');
    expect(result.message).toContain('unknown-key');
  });

  it('missing name returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\ndescription: A description\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Missing 'name'");
  });

  it('missing description returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my-skill\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Missing 'description'");
  });

  it('invalid name with uppercase returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: MySkill\ndescription: desc\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('hyphen-case');
  });

  it('name with consecutive hyphens returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my--skill\ndescription: desc\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('consecutive hyphens');
  });

  it('name starting with hyphen returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: -my-skill\ndescription: desc\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('start/end with hyphen');
  });

  it('description with angle brackets returns valid=false', () => {
    const dir = createTmpDir();
    writeSkillMd(dir, '---\nname: my-skill\ndescription: Use <this> skill\n---\n');

    const result = validateSkill(dir);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('angle brackets');
  });
});
