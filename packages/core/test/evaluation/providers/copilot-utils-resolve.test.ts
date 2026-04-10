import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePlatformCliPath } from '../../../src/evaluation/providers/copilot-utils.js';

const osPart = platform() === 'win32' ? 'win32' : platform() === 'darwin' ? 'darwin' : 'linux';
const archPart = arch() === 'arm64' ? 'arm64' : 'x64';
const binaryName = platform() === 'win32' ? 'copilot.exe' : 'copilot';

describe('resolvePlatformCliPath — global npm fallback', () => {
  let tempDir: string;
  const savedEnv = { ...process.env };
  const savedCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'agentv-copilot-resolve-'));
    // Work from an isolated cwd so the local walk-up path cannot match a real
    // @github/copilot installation in the workspace.
    const cwd = path.join(tempDir, 'cwd');
    await mkdir(cwd, { recursive: true });
    process.chdir(cwd);
    // Isolate every probed root so the resolver cannot pick up a real
    // @github/copilot installation on the developer's machine.
    process.env.APPDATA = path.join(tempDir, 'appdata');
    process.env.USERPROFILE = path.join(tempDir, 'user');
    process.env.HOME = path.join(tempDir, 'user');
    process.env.npm_config_prefix = path.join(tempDir, 'prefix');
  });

  afterEach(async () => {
    process.chdir(savedCwd);
    process.env = { ...savedEnv };
    await rm(tempDir, { recursive: true, force: true });
  });

  async function placeBinary(root: string): Promise<string> {
    const dir = path.join(root, '@github', `copilot-${osPart}-${archPart}`);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, binaryName);
    await writeFile(file, '');
    return file;
  }

  it('finds a binary installed under %APPDATA%\\npm\\node_modules on Windows', async () => {
    if (platform() !== 'win32') return;
    const root = path.join(process.env.APPDATA as string, 'npm', 'node_modules');
    const expected = await placeBinary(root);
    expect(resolvePlatformCliPath()).toBe(expected);
  });

  it('finds a binary installed under npm_config_prefix', async () => {
    const prefix = process.env.npm_config_prefix as string;
    const root =
      platform() === 'win32'
        ? path.join(prefix, 'node_modules')
        : path.join(prefix, 'lib', 'node_modules');
    const expected = await placeBinary(root);
    expect(resolvePlatformCliPath()).toBe(expected);
  });

  it('finds a binary under the nested @github/copilot/node_modules layout', async () => {
    const prefix = process.env.npm_config_prefix as string;
    const root =
      platform() === 'win32'
        ? path.join(prefix, 'node_modules')
        : path.join(prefix, 'lib', 'node_modules');
    const nestedRoot = path.join(root, '@github', 'copilot', 'node_modules');
    const expected = await placeBinary(nestedRoot);
    expect(resolvePlatformCliPath()).toBe(expected);
  });
});
