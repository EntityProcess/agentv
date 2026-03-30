#!/usr/bin/env bun
/**
 * Validates YAML frontmatter in agent, skill, and command .md files.
 *
 * Usage:
 *   bun scripts/marketplace/validate-frontmatter.ts                  # scan plugins/
 *   bun scripts/marketplace/validate-frontmatter.ts /path/to/dir     # scan specific directory
 *   bun scripts/marketplace/validate-frontmatter.ts file1.md file2.md
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]/;
const BOM = /^\uFEFF/;
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/;

function quoteSpecialValues(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z_-]+):\s+(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (!key || !value) {
        result.push(line);
        continue;
      }
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result.push(line);
        continue;
      }
      // Skip YAML block scalar indicators (>, >-, |, |-, etc.)
      if (/^[>|][+-]?$/.test(value.trim())) {
        result.push(line);
        continue;
      }
      if (YAML_SPECIAL_CHARS.test(value)) {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        result.push(`${key}: "${escaped}"`);
        continue;
      }
    }
    result.push(line);
  }

  return result.join('\n');
}

interface ParseResult {
  frontmatter: Record<string, unknown>;
  content: string;
  error?: string;
}

function parseFrontmatter(markdown: string): ParseResult {
  const match = markdown.replace(BOM, '').match(FRONTMATTER_REGEX);

  if (!match) {
    return { frontmatter: {}, content: markdown, error: 'No frontmatter found' };
  }

  const frontmatterText = quoteSpecialValues(match[1] || '');
  const content = markdown.slice(match[0].length);

  try {
    const parsed = parseYaml(frontmatterText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, content };
    }
    return {
      frontmatter: {},
      content,
      error: `YAML parsed but result is not an object (got ${typeof parsed}${Array.isArray(parsed) ? ' array' : ''})`,
    };
  } catch (err) {
    return {
      frontmatter: {},
      content,
      error: `YAML parse failed: ${err instanceof Error ? err.message : err}`,
    };
  }
}

type FileType = 'agent' | 'skill' | 'command';

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

function validateAgent(fm: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!fm.name || typeof fm.name !== 'string')
    issues.push({ level: 'error', message: 'Missing required "name" field' });
  if (!fm.description || typeof fm.description !== 'string')
    issues.push({ level: 'error', message: 'Missing required "description" field' });
  return issues;
}

function validateSkill(fm: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!fm.description && !fm.when_to_use)
    issues.push({ level: 'error', message: 'Missing required "description" field' });
  return issues;
}

function validateCommand(fm: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!fm.description || typeof fm.description !== 'string')
    issues.push({ level: 'error', message: 'Missing required "description" field' });
  return issues;
}

function detectFileType(filePath: string): FileType | null {
  const normalized = filePath.replace(/\\/g, '/');
  const inSkillContent = /\/skills\/[^/]+\//.test(normalized);
  if (normalized.includes('/agents/') && !inSkillContent && basename(filePath) !== 'README.md')
    return 'agent';
  if (normalized.includes('/skills/') && basename(filePath) === 'SKILL.md') return 'skill';
  if (normalized.includes('/commands/') && !inSkillContent) return 'command';
  return null;
}

async function findMdFiles(baseDir: string): Promise<{ path: string; type: FileType }[]> {
  const results: { path: string; type: FileType }[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const type = detectFileType(fullPath);
        if (type) results.push({ path: fullPath, type });
      }
    }
  }

  await walk(baseDir);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(import.meta.dirname, '../..');

  let files: { path: string; type: FileType }[];
  let baseDir: string;

  if (args.length > 0 && args.every((a) => a.endsWith('.md'))) {
    baseDir = process.cwd();
    files = [];
    for (const arg of args) {
      const fullPath = resolve(arg);
      const type = detectFileType(fullPath);
      if (type) files.push({ path: fullPath, type });
    }
  } else {
    baseDir = args[0] || resolve(root, 'plugins');
    files = await findMdFiles(baseDir);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`Validating ${files.length} frontmatter files...\n`);

  for (const { path: filePath, type } of files) {
    const rel = relative(baseDir, filePath);
    const content = await readFile(filePath, 'utf-8');
    const result = parseFrontmatter(content);

    const issues: ValidationIssue[] = [];

    if (result.error) {
      issues.push({ level: 'error', message: result.error });
    } else {
      switch (type) {
        case 'agent':
          issues.push(...validateAgent(result.frontmatter));
          break;
        case 'skill':
          issues.push(...validateSkill(result.frontmatter));
          break;
        case 'command':
          issues.push(...validateCommand(result.frontmatter));
          break;
      }
    }

    if (issues.length > 0) {
      console.log(`${rel} (${type})`);
      for (const issue of issues) {
        const prefix = issue.level === 'error' ? '  ERROR' : '  WARN ';
        console.log(`${prefix}: ${issue.message}`);
        if (issue.level === 'error') totalErrors++;
        else totalWarnings++;
      }
      console.log();
    }
  }

  console.log('---');
  console.log(`Validated ${files.length} files: ${totalErrors} errors, ${totalWarnings} warnings`);

  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
