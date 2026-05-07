/**
 * `agentv skills` — serve bundled skill content from inside the CLI tarball.
 *
 * Skills are bundled into `dist/skills/<name>/` at build time (see tsup.config.ts).
 * This ensures skill content always matches the installed CLI version — no drift possible.
 *
 * Subcommands:
 *   list                       — print skill names (one per line, or JSON with --json)
 *   get <name>                 — print SKILL.md content
 *   get <name> --full          — also include references/, templates/, agents/
 *   get <name> --ref <file>    — print one reference file (searches references/, templates/, agents/, then skill root)
 *   get <name> --all           — get all skills
 *   get --all                  — get all skills
 *   path [<name>]              — print resolved path to skills dir or specific skill dir
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
import { command, flag, option, optional, positional, string, subcommands } from 'cmd-ts';

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
 * a directory that contains actual skill content. In priority order at
 * each ancestor level:
 *   1. `dist/skills/` — production npm install (binary at dist/cli.js,
 *      skills are a sibling) and post-build dev runs.
 *   2. `skills-data/` — repo-root source layout (mirrors agent-browser's
 *      top-level `skill-data/`); used when running from TypeScript source
 *      without a build.
 *   3. `skills/` — legacy in-package location, retained for backward
 *      compatibility with any downstream consumer that still bundles
 *      this module without the dist copy step.
 */
function findSkillsDir(): string | null {
  const selfFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(selfFile);
  for (let i = 0; i < 6; i++) {
    const distCandidate = path.join(dir, 'dist', 'skills');
    if (isValidSkillsDir(distCandidate)) return distCandidate;
    const repoRootCandidate = path.join(dir, 'skills-data');
    if (isValidSkillsDir(repoRootCandidate)) return repoRootCandidate;
    const legacyCandidate = path.join(dir, 'skills');
    if (isValidSkillsDir(legacyCandidate)) return legacyCandidate;
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

  // Collect extra directories: references/, templates/, agents/
  const files: Record<string, string> = {};
  for (const sub of ['references', 'templates', 'agents']) {
    const subDir = path.join(skillDir, sub);
    const collected = collectDir(subDir, sub);
    Object.assign(files, collected);
  }
  return { name, content, files: Object.keys(files).length > 0 ? files : undefined };
}

/**
 * Find a single reference file by name within a skill.
 *
 * Search order: references/, templates/, agents/, then the skill root for
 * a bare filename. The name may include or omit the `.md` extension — we
 * try the literal name first, then with `.md` appended, so callers can
 * write `--ref eval-yaml-spec` instead of `--ref eval-yaml-spec.md`.
 */
function findRefFile(
  skillDir: string,
  refName: string,
): { relPath: string; content: string } | null {
  const candidates = refName.endsWith('.md') ? [refName] : [refName, `${refName}.md`];
  for (const sub of ['references', 'templates', 'agents']) {
    for (const candidate of candidates) {
      const filePath = path.join(skillDir, sub, candidate);
      if (existsSync(filePath)) {
        return { relPath: `${sub}/${candidate}`, content: readFileSync(filePath, 'utf-8') };
      }
    }
  }
  // Bare name in the skill root (e.g. LICENSE.txt)
  for (const candidate of candidates) {
    const filePath = path.join(skillDir, candidate);
    if (existsSync(filePath)) {
      return { relPath: candidate, content: readFileSync(filePath, 'utf-8') };
    }
  }
  return null;
}

/**
 * List ref-discoverable filenames inside a skill (used to print a useful
 * error when a `--ref` lookup misses).
 */
function listRefFiles(skillDir: string): string[] {
  const out: string[] = [];
  for (const sub of ['references', 'templates', 'agents']) {
    const subDir = path.join(skillDir, sub);
    if (!existsSync(subDir)) continue;
    for (const entry of readdirSync(subDir, { withFileTypes: true })) {
      if (entry.isFile()) out.push(`${sub}/${entry.name}`);
    }
  }
  return out.sort();
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
      description: 'Also include files under references/, templates/, and agents/',
    }),
    ref: option({
      type: optional(string),
      long: 'ref',
      description:
        'Load a single reference file by name (searches references/, templates/, agents/). Takes precedence over --full.',
    }),
    json: flag({ long: 'json', description: 'Output as JSON' }),
  },
  handler: ({ name, all, full, ref, json }) => {
    const skillsDir = requireSkillsDir();

    if (ref !== undefined && all) {
      const msg = '--ref is incompatible with --all';
      if (json) {
        process.stdout.write(`${JSON.stringify({ success: false, error: msg })}\n`);
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exit(1);
    }

    if (ref !== undefined) {
      if (name === undefined) {
        const msg = '--ref requires a skill name';
        if (json) {
          process.stdout.write(`${JSON.stringify({ success: false, error: msg })}\n`);
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }
      const skillDir = path.join(skillsDir, name);
      if (!existsSync(skillDir)) {
        const msg = `skill '${name}' not found`;
        if (json) {
          process.stdout.write(`${JSON.stringify({ success: false, error: msg })}\n`);
        } else {
          console.error(`Error: ${msg}`);
          const available = listSkillNames(skillsDir);
          if (available.length > 0) {
            console.error(`Available skills: ${available.join(', ')}`);
          }
        }
        process.exit(1);
      }
      const file = findRefFile(skillDir, ref);
      if (!file) {
        const msg = `reference '${ref}' not found in skill '${name}'`;
        if (json) {
          process.stdout.write(`${JSON.stringify({ success: false, error: msg })}\n`);
        } else {
          console.error(`Error: ${msg}`);
          const available = listRefFiles(skillDir);
          if (available.length > 0) {
            console.error(`Available reference files:\n  ${available.join('\n  ')}`);
          }
        }
        process.exit(1);
      }
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ success: true, data: [{ name, content: file.content, files: { [file.relPath]: file.content } }] })}\n`,
        );
        return;
      }
      process.stdout.write(file.content);
      if (!file.content.endsWith('\n')) process.stdout.write('\n');
      return;
    }

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
