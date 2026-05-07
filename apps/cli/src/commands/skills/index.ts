/**
 * `agentv skills` — serve bundled skill content from inside the CLI tarball.
 *
 * Skills are bundled into `dist/skills/<name>/` at build time (see tsup.config.ts).
 * This ensures skill content always matches the installed CLI version — no drift possible.
 *
 * Subcommands:
 *   list              — print skill names (one per line, or JSON with --json)
 *   get <name>        — print SKILL.md content; --full also includes references/ and templates/
 *   get <name> --all  — get all skills
 *   get --all         — get all skills
 *   path [<name>]     — print resolved path to skills dir or specific skill dir
 *
 * Resolution: walk from this module's file upward to find `dist/skills/` or `skills/`
 * that contains actual skill content (validated by presence of SKILL.md files).
 * Production npm install: binary at dist/cli.js → dist/skills/ is a sibling.
 * Source run (bun src/cli.ts): walks up to apps/cli/ where dist/skills/ lives.
 *
 * JSON output (--json) schema:
 *   { success: true, data: [{ name: string, content: string, files?: Record<string,string> }] }
 *   { success: false, error: string }
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, flag, optional, positional, string, subcommands } from 'cmd-ts';

// ── Resolution ────────────────────────────────────────────────────────────────

/** A valid skills dir contains at least one subdirectory with a SKILL.md file. */
function isValidSkillsDir(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'SKILL.md')),
    );
  } catch {
    return false;
  }
}

/**
 * Walk from the directory containing this module's source file up to find
 * a `dist/skills` or `skills` directory that contains actual skill content.
 * Covers:
 *   - Production npm install: binary at dist/cli.js → dist/skills/ is sibling
 *   - Source run (bun src/cli.ts): walking up finds apps/cli/skills/ or apps/cli/dist/skills/
 */
function findSkillsDir(): string | null {
  const selfFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(selfFile);
  for (let i = 0; i < 6; i++) {
    // Prefer dist/skills/ over bare skills/ to match the production layout
    const distCandidate = path.join(dir, 'dist', 'skills');
    if (isValidSkillsDir(distCandidate)) return distCandidate;
    const candidate = path.join(dir, 'skills');
    if (isValidSkillsDir(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function requireSkillsDir(): string {
  const dir = findSkillsDir();
  if (!dir) {
    console.error(
      'Error: bundled skills directory not found. This is a build issue — please reinstall agentv.',
    );
    process.exit(1);
  }
  return dir;
}

// ── Skill reading ─────────────────────────────────────────────────────────────

interface SkillData {
  name: string;
  content: string;
  files?: Record<string, string>;
}

function listSkillNames(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function readSkillFile(skillDir: string, relPath: string): string | null {
  const full = path.join(skillDir, relPath);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf-8');
}

/**
 * Recursively collect all files under a subdirectory.
 * Returns a map of relative paths → contents.
 */
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

function readSkill(skillsDir: string, name: string, full: boolean): SkillData | null {
  const skillDir = path.join(skillsDir, name);
  if (!existsSync(skillDir)) return null;

  const content = readSkillFile(skillDir, 'SKILL.md');
  if (content === null) return null;

  if (!full) return { name, content };

  // Collect extra directories: references/ and templates/
  const files: Record<string, string> = {};
  for (const sub of ['references', 'templates']) {
    const subDir = path.join(skillDir, sub);
    const collected = collectDir(subDir, sub);
    Object.assign(files, collected);
  }
  return { name, content, files: Object.keys(files).length > 0 ? files : undefined };
}

// ── Output helpers ────────────────────────────────────────────────────────────

function printSkill(skill: SkillData, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ success: true, data: [skill] })}\n`);
    return;
  }
  process.stdout.write(skill.content);
  if (!skill.content.endsWith('\n')) process.stdout.write('\n');
  if (skill.files) {
    for (const [relPath, content] of Object.entries(skill.files)) {
      process.stdout.write(`\n--- ${relPath} ---\n`);
      process.stdout.write(content);
      if (!content.endsWith('\n')) process.stdout.write('\n');
    }
  }
}

// ── Subcommands ───────────────────────────────────────────────────────────────

const skillsListCommand = command({
  name: 'list',
  description: 'List available bundled skills',
  args: {
    json: flag({ long: 'json', description: 'Output as JSON' }),
  },
  handler: ({ json }) => {
    const skillsDir = requireSkillsDir();
    const names = listSkillNames(skillsDir);
    if (json) {
      process.stdout.write(`${JSON.stringify({ success: true, data: names })}\n`);
    } else {
      for (const name of names) {
        console.log(name);
      }
    }
  },
});

const skillsGetCommand = command({
  name: 'get',
  description: 'Get skill content by name (or --all for all skills)',
  args: {
    name: positional({ type: optional(string), displayName: 'name', description: 'Skill name' }),
    all: flag({ long: 'all', description: 'Get all skills' }),
    full: flag({
      long: 'full',
      description: 'Also include files under references/ and templates/',
    }),
    json: flag({ long: 'json', description: 'Output as JSON' }),
  },
  handler: ({ name, all, full, json }) => {
    const skillsDir = requireSkillsDir();

    if (all || name === undefined) {
      const names = listSkillNames(skillsDir);
      const skills = names
        .map((n) => readSkill(skillsDir, n, full))
        .filter((s): s is SkillData => s !== null);

      if (json) {
        process.stdout.write(`${JSON.stringify({ success: true, data: skills })}\n`);
        return;
      }
      for (const skill of skills) {
        if (skills.length > 1) {
          process.stdout.write(`\n=== ${skill.name} ===\n\n`);
        }
        printSkill(skill, false);
      }
      return;
    }

    const skill = readSkill(skillsDir, name, full);
    if (!skill) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ success: false, error: `Skill '${name}' not found` })}\n`,
        );
      } else {
        console.error(`Error: skill '${name}' not found`);
        const available = listSkillNames(skillsDir);
        if (available.length > 0) {
          console.error(`Available skills: ${available.join(', ')}`);
        }
      }
      process.exit(1);
    }

    printSkill(skill, json);
  },
});

const skillsPathCommand = command({
  name: 'path',
  description: 'Print path to bundled skills directory (or specific skill directory)',
  args: {
    name: positional({ type: optional(string), displayName: 'name', description: 'Skill name' }),
  },
  handler: ({ name }) => {
    const skillsDir = requireSkillsDir();
    if (name) {
      const skillDir = path.join(skillsDir, name);
      if (!existsSync(skillDir)) {
        console.error(`Error: skill '${name}' not found`);
        process.exit(1);
      }
      console.log(skillDir);
    } else {
      console.log(skillsDir);
    }
  },
});

export const skillsCommand = subcommands({
  name: 'skills',
  description: 'List and retrieve bundled AgentV skills',
  cmds: {
    list: skillsListCommand,
    get: skillsGetCommand,
    path: skillsPathCommand,
  },
});
