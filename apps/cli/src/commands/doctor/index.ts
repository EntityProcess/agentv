/**
 * `agentv doctor` — reports presence/absence of external dependencies.
 *
 * For each known external dep, checks whether the binary is on PATH (or in
 * ~/.agentv/bin/) and reports its version. Missing deps include an install hint.
 *
 * Exit codes:
 *   0  — all deps present
 *   1  — one or more deps missing
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { command } from 'cmd-ts';

import { getAgentvConfigDir } from '@agentv/core';

interface DepCheck {
  name: string;
  description: string;
  installHint: string;
}

const DEPS: DepCheck[] = [];

function findBinary(name: string): string | undefined {
  // Check ~/.agentv/bin first (installed by agentv install)
  const localBin = path.join(getAgentvConfigDir(), 'bin', name);
  if (existsSync(localBin)) return localBin;

  // Fall back to PATH
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getBinaryVersion(binaryPath: string): string {
  try {
    const output = execFileSync(binaryPath, ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
    return output.trim().split('\n')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const doctorCommand = command({
  name: 'doctor',
  description: 'Check external dependencies required by agentv',
  args: {},
  handler: () => {
    const binDir = path.join(getAgentvConfigDir(), 'bin');
    console.log('agentv doctor\n');
    console.log(`Local bin dir: ${binDir}\n`);

    let allPresent = true;

    for (const dep of DEPS) {
      const binaryPath = findBinary(dep.name);
      if (binaryPath) {
        const version = getBinaryVersion(binaryPath);
        console.log(`  ✓ ${dep.name}`);
        console.log(`      path:    ${binaryPath}`);
        console.log(`      version: ${version}`);
        console.log(`      note:    ${dep.description}`);
      } else {
        allPresent = false;
        console.log(`  ✗ ${dep.name}  (not found)`);
        console.log(`      note:    ${dep.description}`);
        console.log(`      install: ${dep.installHint}`);
      }
      console.log();
    }

    if (!allPresent) {
      process.exit(1);
    }
  },
});
