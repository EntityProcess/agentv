import { readFileSync } from 'node:fs';

const payload = JSON.parse(readFileSync(0, 'utf8')) as { path?: string };

if (!payload.path) {
  throw new Error('missing file path');
}

// Example-only placeholder transformation. Copy this script into your project
// and replace it with real spreadsheet extraction logic.
console.log('spreadsheet: revenue,total');
console.log('Q1,42');
