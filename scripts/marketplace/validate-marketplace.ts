#!/usr/bin/env bun
/**
 * Validates marketplace.json: well-formed JSON, plugins array present,
 * each entry has required fields, no duplicates, and .github copy is in sync.
 *
 * Usage:
 *   bun scripts/marketplace/validate-marketplace.ts
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const src = resolve(root, '.claude-plugin/marketplace.json');
const dest = resolve(root, '.github/plugin/marketplace.json');

// --- 1. JSON validation ---

const content = await readFile(src, 'utf-8');

let parsed: unknown;
try {
  parsed = JSON.parse(content);
} catch (err) {
  console.error(
    `[json] ERROR: .claude-plugin/marketplace.json is not valid JSON: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
  console.error('[json] ERROR: .claude-plugin/marketplace.json must be a JSON object');
  process.exit(1);
}

const marketplace = parsed as Record<string, unknown>;
if (!Array.isArray(marketplace.plugins)) {
  console.error('[json] ERROR: .claude-plugin/marketplace.json missing "plugins" array');
  process.exit(1);
}

// --- 2. Plugin entry validation ---

const errors: string[] = [];
const seen = new Set<string>();
const required = ['name', 'description', 'source'] as const;

marketplace.plugins.forEach((p: unknown, i: number) => {
  if (!p || typeof p !== 'object') {
    errors.push(`plugins[${i}]: must be an object`);
    return;
  }
  const entry = p as Record<string, unknown>;
  for (const field of required) {
    if (!entry[field]) {
      errors.push(`plugins[${i}] (${entry.name ?? '?'}): missing required field "${field}"`);
    }
  }
  if (typeof entry.name === 'string') {
    if (seen.has(entry.name)) {
      errors.push(`plugins[${i}]: duplicate plugin name "${entry.name}"`);
    }
    seen.add(entry.name);
  }
});

if (errors.length) {
  console.error(
    `[schema] ${errors.length} validation error(s) in .claude-plugin/marketplace.json:`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// --- 3. Sync check (.claude-plugin → .github/plugin) ---

let destContent: string;
try {
  destContent = await readFile(dest, 'utf-8');
} catch {
  console.error('[sync] ERROR: .github/plugin/marketplace.json not found');
  console.error('  Run: bun scripts/marketplace/sync.ts');
  process.exit(1);
}

if (content !== destContent) {
  console.error(
    '[sync] ERROR: .github/plugin/marketplace.json is out of sync with .claude-plugin/marketplace.json',
  );
  console.error('  Run: bun scripts/marketplace/sync.ts');
  process.exit(1);
}

console.log(`OK: ${marketplace.plugins.length} plugins validated, sync verified`);
