import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../../..');

function readJson(filePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, filePath), 'utf8')) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };
}

function listFiles(dir: string): string[] {
  const absoluteDir = path.join(repoRoot, dir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(repoRoot, absolutePath);
    return statSync(absolutePath).isDirectory() ? listFiles(relativePath) : [relativePath];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}

describe('core/sdk package graph', () => {
  it('keeps runtime package dependencies acyclic', () => {
    const sdkPackage = readJson('packages/sdk/package.json');
    const corePackage = readJson('packages/core/package.json');

    expect(sdkPackage.dependencies?.['@agentv/core']).toBe('workspace:*');
    expect(corePackage.dependencies?.['@agentv/sdk']).toBeUndefined();
    expect(corePackage.devDependencies?.['@agentv/sdk']).toBeUndefined();
  });

  it('keeps core source and tests from importing sdk source', () => {
    const offenders = [...listFiles('packages/core/src'), ...listFiles('packages/core/test')]
      .filter((filePath) => /\.(?:ts|tsx|js|mjs|cjs)$/.test(filePath))
      .filter((filePath) => {
        const source = readFileSync(path.join(repoRoot, filePath), 'utf8');
        return importSpecifiers(source).some(
          (specifier) => specifier === '@agentv/sdk' || specifier.includes('/sdk/src/'),
        );
      });

    expect(offenders).toEqual([]);
  });
});
