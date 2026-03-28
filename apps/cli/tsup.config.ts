import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: false,
  target: 'node20',
  platform: 'node',
  tsconfig: './tsconfig.build.json',
  // Bundle @agentv/core but keep micromatch and pi-agent packages external (they have dynamic requires)
  noExternal: [/^@agentv\//, 'cmd-ts'],
  external: [
    'micromatch',
    '@mariozechner/pi-agent-core',
    '@mariozechner/pi-ai',
    '@mariozechner/pi-coding-agent',
    '@github/copilot-sdk',
    '@openai/codex-sdk',
    '@anthropic-ai/claude-agent-sdk',
  ],
  // Provide a real require() for bundled CJS modules (e.g. debug) that need Node.js builtins like tty
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Copy template files after build
  onSuccess: async () => {
    const srcTemplatesDir = path.join('src', 'templates');
    const distTemplatesDir = path.join('dist', 'templates');

    // Remove stale templates so externally-added files (e.g. plugin skills)
    // don't survive builds and accidentally ship in the npm package
    rmSync(distTemplatesDir, { recursive: true, force: true });

    // Copy entire templates directory structure recursively
    cpSync(srcTemplatesDir, distTemplatesDir, {
      recursive: true,
      filter: (src) => {
        // Skip index.ts and any TypeScript files
        return !src.endsWith('.ts');
      },
    });

    console.log('✓ Template files copied to dist/templates');

    // Copy studio dist if available (built by apps/studio)
    const studioDistDir = path.resolve('..', 'studio', 'dist');
    const cliStudioDir = path.join('dist', 'studio');
    if (existsSync(studioDistDir)) {
      rmSync(cliStudioDir, { recursive: true, force: true });
      cpSync(studioDistDir, cliStudioDir, { recursive: true });
      console.log('✓ Studio dist copied to dist/studio');
    } else {
      console.log('⚠ Studio dist not found at', studioDistDir, '— skipping');
    }
  },
});
