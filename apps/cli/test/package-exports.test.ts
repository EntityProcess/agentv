import { describe, expect, it } from 'bun:test';
import { constants, accessSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dir, '../../..');
const cliPackageDir = path.join(repoRoot, 'apps/cli');
const cliDistDir = path.join(cliPackageDir, 'dist');

function readJson(filePath: string) {
  return JSON.parse(readFileSync(path.join(repoRoot, filePath), 'utf8')) as {
    readonly private?: boolean;
    readonly exports?: Record<string, unknown>;
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };
}

function assertBuilt(fileName: string): string {
  const distPath = path.join(cliDistDir, fileName);
  try {
    accessSync(distPath, constants.R_OK);
  } catch {
    throw new Error('agentv package artifact is not built. Run `bun run build` first.');
  }
  return distPath;
}

async function importDist(fileName: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(assertBuilt(fileName)).href)) as Record<string, unknown>;
}

describe('agentv package exports', () => {
  it('publishes agentv as the only public package facade', () => {
    const agentvPackage = readJson('apps/cli/package.json');
    const corePackage = readJson('packages/core/package.json');
    const sdkPackage = readJson('packages/sdk/package.json');

    expect(corePackage.private).toBe(true);
    expect(sdkPackage.private).toBe(true);
    expect(agentvPackage.exports).toMatchObject({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './sdk': {
        types: './dist/sdk.d.ts',
        import: './dist/sdk.js',
      },
      './provider': {
        types: './dist/provider.d.ts',
        import: './dist/provider.js',
      },
      './config': {
        types: './dist/config.d.ts',
        import: './dist/config.js',
      },
    });
  });

  it('keeps the public facade separate from CLI command assembly', () => {
    const publicIndex = readFileSync(path.join(cliPackageDir, 'src/index.ts'), 'utf8');
    const publicSdk = readFileSync(path.join(cliPackageDir, 'src/sdk.ts'), 'utf8');
    const cliEntry = readFileSync(path.join(cliPackageDir, 'src/cli.ts'), 'utf8');

    expect(publicIndex).not.toContain('./cli-app');
    expect(publicSdk).not.toContain('./cli-app');
    expect(cliEntry).toContain('./cli-app.js');
  });

  it('loads SDK, provider, and config helpers from built agentv artifacts', async () => {
    const rootFacade = await importDist('index.js');
    const sdkFacade = await importDist('sdk.js');
    const providerFacade = await importDist('provider.js');
    const configFacade = await importDist('config.js');

    expect(typeof rootFacade.evaluate).toBe('function');
    expect(typeof rootFacade.defineScriptGrader).toBe('function');
    expect(typeof rootFacade.defineAssertion).toBe('function');
    expect(typeof rootFacade.definePromptTemplate).toBe('function');
    expect(typeof rootFacade.defineEval).toBe('function');
    expect(typeof rootFacade.graders).toBe('object');
    expect(typeof rootFacade.defineConfig).toBe('function');

    expect(sdkFacade.evaluate).toBe(rootFacade.evaluate);
    expect(sdkFacade.defineScriptGrader).toBe(rootFacade.defineScriptGrader);
    expect(typeof providerFacade.createBuiltinProviderRegistry).toBe('function');
    expect(typeof providerFacade.createProvider).toBe('function');
    expect(configFacade.defineConfig).toBe(rootFacade.defineConfig);
  });
});
