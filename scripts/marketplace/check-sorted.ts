#!/usr/bin/env bun
/**
 * Checks that marketplace.json plugins are alphabetically sorted by name.
 *
 * Usage:
 *   bun scripts/marketplace/check-sorted.ts           # check, exit 1 if unsorted
 *   bun scripts/marketplace/check-sorted.ts --fix     # sort in place
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const MARKETPLACE = resolve(root, '.claude-plugin/marketplace.json');

type Plugin = { name: string; [k: string]: unknown };
type Marketplace = { plugins: Plugin[]; [k: string]: unknown };

const raw = readFileSync(MARKETPLACE, 'utf8');
const mp: Marketplace = JSON.parse(raw);

const cmp = (a: Plugin, b: Plugin) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

if (process.argv.includes('--fix')) {
  mp.plugins.sort(cmp);
  writeFileSync(MARKETPLACE, `${JSON.stringify(mp, null, 2)}\n`);
  console.log(`Sorted ${mp.plugins.length} plugins`);
  process.exit(0);
}

for (let i = 1; i < mp.plugins.length; i++) {
  if (cmp(mp.plugins[i - 1], mp.plugins[i]) > 0) {
    console.error(
      `marketplace.json plugins are not sorted: '${mp.plugins[i - 1].name}' should come after '${mp.plugins[i].name}' (index ${i})`,
    );
    console.error('  run: bun scripts/marketplace/check-sorted.ts --fix');
    process.exit(1);
  }
}

console.log(`OK: ${mp.plugins.length} plugins sorted`);
