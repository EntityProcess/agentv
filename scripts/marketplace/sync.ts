#!/usr/bin/env bun
/**
 * Syncs marketplace.json from .claude-plugin/ to .github/plugin/.
 *
 * Usage:
 *   bun scripts/marketplace/sync.ts
 */

import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const src = resolve(root, '.claude-plugin/marketplace.json');
const dest = resolve(root, '.github/plugin/marketplace.json');

await cp(src, dest);
console.log('Synced marketplace.json → .github/plugin/marketplace.json');
