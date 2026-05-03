/**
 * check-pi-ai-shim.ts
 *
 * Validates that packages/core/src/evaluation/providers/pi-ai-shim.d.ts stays
 * structurally compatible with the published types of @mariozechner/pi-ai.
 *
 * The shim re-declares pi-ai's public surface so our static imports resolve
 * (pi-ai's published d.ts has cross-module re-exports that don't surface
 * under NodeNext). If pi-ai ships a breaking change — renamed field, removed
 * function — the shim stays valid TypeScript while our runtime drifts.
 * This script catches that drift.
 *
 * Checks performed:
 *   - Every interface declared in the shim exists in pi-ai's published .d.ts
 *     files, and every field name we declare is also declared upstream.
 *   - Every function declared in the shim is exported by pi-ai's d.ts.
 *
 * Field types are NOT compared — too much surface and rarely the source of
 * silent drift. Type-level breakage would surface as a TypeScript error in
 * llm-providers.ts; the unit-test suite covers runtime export presence.
 *
 * Usage:
 *   bun scripts/check-pi-ai-shim.ts
 *
 * Wired into the pre-push hook (see .pre-commit-config.yaml).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Locate pi-ai's installed dist directory and our shim source.
//
// Bun's package layout keeps each version under node_modules/.bun/<name>@<v>+<hash>/
// rather than hoisting to node_modules/<name>/. require.resolve from this
// script's location can't reach it (we're not inside packages/core's resolution
// path). Walk node_modules/.bun directly — first match wins, since we only
// install one pi-ai version.
// ---------------------------------------------------------------------------

function findPiAiDistDir(): string {
  const bunDir = resolve('node_modules/.bun');
  if (!existsSync(bunDir)) {
    throw new Error(`node_modules/.bun does not exist at ${bunDir} — run \`bun install\`?`);
  }
  for (const entry of readdirSync(bunDir)) {
    if (entry.startsWith('@mariozechner+pi-ai@')) {
      const dist = join(bunDir, entry, 'node_modules', '@mariozechner', 'pi-ai', 'dist');
      if (existsSync(dist)) return dist;
    }
  }
  throw new Error('Could not locate @mariozechner/pi-ai under node_modules/.bun.');
}

const piAiDistDir = findPiAiDistDir();
const shimPath = resolve('packages/core/src/evaluation/providers/pi-ai-shim.d.ts');

// ---------------------------------------------------------------------------
// Read all .d.ts files under pi-ai/dist into one concatenated source string.
// Pi-ai re-exports across modules; concatenating lets us search for any
// declaration regardless of which file it lives in.
// ---------------------------------------------------------------------------

function readDtsRecursive(dir: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      parts.push(readDtsRecursive(path));
    } else if (entry.name.endsWith('.d.ts')) {
      parts.push(readFileSync(path, 'utf8'));
    }
  }
  return parts.join('\n');
}

const upstreamSource = readDtsRecursive(piAiDistDir);
const shimSource = readFileSync(shimPath, 'utf8');

// ---------------------------------------------------------------------------
// Lightweight d.ts parser: extract interface names + their top-level field
// names, and exported function names. Not a full TS parser — enough for the
// shapes we care about. Uses brace-counting so multi-line bodies and nested
// type literals don't trip it.
// ---------------------------------------------------------------------------

function extractInterfaces(source: string): Map<string, Set<string>> {
  const interfaces = new Map<string, Set<string>>();
  // Match: `export interface Name<T,U>(?: extends ...)? {`
  const startPattern = /export\s+interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+[^{]+)?\s*\{/g;
  let m: RegExpExecArray | null;
  while (true) {
    m = startPattern.exec(source);
    if (!m) break;
    const name = m[1];
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    const body = source.slice(bodyStart, i - 1);
    interfaces.set(name, extractTopLevelFieldNames(body));
  }
  return interfaces;
}

function extractTopLevelFieldNames(body: string): Set<string> {
  const fields = new Set<string>();
  let depth = 0;
  let lineStart = 0;
  // Walk the body splitting on `;` `,` and newlines but only at depth 0 so
  // nested type literals (e.g. `cost: { input: number; ... }`) stay together.
  for (let j = 0; j <= body.length; j++) {
    const c = body[j];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if ((c === '\n' || c === ';' || c === ',' || j === body.length) && depth === 0) {
      const line = body.slice(lineStart, j).trim();
      const fieldMatch = line.match(/^(?:readonly\s+)?(\w+)\s*\??\s*:/);
      if (fieldMatch) fields.add(fieldMatch[1]);
      lineStart = j + 1;
    }
  }
  return fields;
}

function extractFunctions(source: string): Set<string> {
  const fns = new Set<string>();
  const re = /export\s+(?:declare\s+)?function\s+(\w+)\s*[(<]/g;
  let m: RegExpExecArray | null;
  while (true) {
    m = re.exec(source);
    if (!m) break;
    fns.add(m[1]);
  }
  return fns;
}

// ---------------------------------------------------------------------------
// Run the checks
// ---------------------------------------------------------------------------

const errors: string[] = [];

// Type structure
const shimInterfaces = extractInterfaces(shimSource);
const upstreamInterfaces = extractInterfaces(upstreamSource);

for (const [name, fields] of shimInterfaces) {
  const upstreamFields = upstreamInterfaces.get(name);
  if (!upstreamFields) {
    errors.push(
      `interface '${name}' is declared in pi-ai-shim.d.ts but not found in pi-ai's published types`,
    );
    continue;
  }
  for (const field of fields) {
    if (!upstreamFields.has(field)) {
      errors.push(`interface '${name}': shim declares field '${field}' that is not in upstream`);
    }
  }
}

const shimFns = extractFunctions(shimSource);
const upstreamFns = extractFunctions(upstreamSource);
for (const fn of shimFns) {
  if (!upstreamFns.has(fn)) {
    errors.push(
      `function '${fn}' is declared in pi-ai-shim.d.ts but not in pi-ai's published types`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(
    'pi-ai-shim drift detected. Update packages/core/src/evaluation/providers/pi-ai-shim.d.ts to match pi-ai:',
  );
  console.error('');
  for (const e of errors) {
    console.error(`  ✗ ${e}`);
  }
  console.error('');
  console.error(`pi-ai d.ts location: ${piAiDistDir}`);
  process.exit(1);
}

const interfaceCount = shimInterfaces.size;
const fnCount = shimFns.size;
console.log(
  `✓ pi-ai-shim is in sync with @mariozechner/pi-ai (${interfaceCount} interfaces, ${fnCount} functions checked)`,
);
