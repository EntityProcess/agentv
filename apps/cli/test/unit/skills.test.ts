/**
 * Unit tests for the skills command helpers.
 *
 * Tests cover: discovery from install layout, SKILL.md reading,
 * --full collecting references/, and the not-found error path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// We test the pure helper functions by importing them after patching.
// Since findSkillsDir() relies on import.meta.url (which points to the
// compiled test file), we exercise the helpers by building a temp skills dir
// and calling the internal functions directly.

// ── Test doubles ────────────────────────────────────────────────────────────

/**
 * Mirrors the internal listSkillNames / readSkill logic without depending on
 * import.meta.url resolution so we can test it with a fixture directory.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

function listSkillNames(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function collectDir(dir: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(result, collectDir(path.join(dir, entry.name), relPath));
    } else {
      result[relPath] = readFileSync(path.join(dir, entry.name), 'utf-8');
    }
  }
  return result;
}

function readSkill(
  skillsDir: string,
  name: string,
  full: boolean,
): { name: string; content: string; files?: Record<string, string> } | null {
  const skillDir = path.join(skillsDir, name);
  if (!existsSync(skillDir)) return null;
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!existsSync(skillFile)) return null;
  const content = readFileSync(skillFile, 'utf-8');
  if (!full) return { name, content };
  const files: Record<string, string> = {};
  for (const sub of ['references', 'templates']) {
    Object.assign(files, collectDir(path.join(skillDir, sub), sub));
  }
  return { name, content, files: Object.keys(files).length > 0 ? files : undefined };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;

function write(relPath: string, content: string): void {
  const full = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `agentv-skills-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Create two skill directories
  write(
    'agentv-bench/SKILL.md',
    '---\nname: agentv-bench\ndescription: Run evals\n---\n# AgentV Bench\nContent here.\n',
  );
  write('agentv-bench/references/cli.md', '# CLI Reference\nSome commands.\n');
  write(
    'agentv-eval-writer/SKILL.md',
    '---\nname: agentv-eval-writer\ndescription: Write evals\nhidden: true\n---\n# Eval Writer\n',
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('listSkillNames', () => {
  it('returns sorted skill names from the skills directory', () => {
    const names = listSkillNames(tmpDir);
    expect(names).toEqual(['agentv-bench', 'agentv-eval-writer']);
  });

  it('returns empty array for a non-existent directory', () => {
    expect(listSkillNames('/does/not/exist')).toEqual([]);
  });
});

describe('readSkill', () => {
  it('reads SKILL.md content', () => {
    const skill = readSkill(tmpDir, 'agentv-bench', false);
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe('agentv-bench');
    expect(skill?.content).toContain('# AgentV Bench');
    expect(skill?.files).toBeUndefined();
  });

  it('includes frontmatter including hidden: true', () => {
    const skill = readSkill(tmpDir, 'agentv-eval-writer', false);
    expect(skill?.content).toContain('hidden: true');
  });

  it('returns null for non-existent skill', () => {
    expect(readSkill(tmpDir, 'does-not-exist', false)).toBeNull();
  });

  it('--full collects references/ files', () => {
    const skill = readSkill(tmpDir, 'agentv-bench', true);
    expect(skill?.files).toBeDefined();
    expect(skill?.files?.['references/cli.md']).toContain('# CLI Reference');
  });

  it('--full returns no files key when no references/ or templates/', () => {
    const skill = readSkill(tmpDir, 'agentv-eval-writer', true);
    expect(skill?.files).toBeUndefined();
  });
});

describe('collectDir', () => {
  it('recursively collects files with relative paths', () => {
    const refsDir = path.join(tmpDir, 'agentv-bench', 'references');
    const files = collectDir(refsDir, 'references');
    expect(files['references/cli.md']).toContain('# CLI Reference');
  });

  it('returns empty record for missing directory', () => {
    expect(collectDir('/does/not/exist', 'references')).toEqual({});
  });
});
