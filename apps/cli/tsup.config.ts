import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'tsup';

const SKILLS_TO_INCLUDE = [
  'agentv-eval-builder',
  'agentv-eval-orchestrator',
  'agentv-prompt-optimizer',
];

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
  external: ['micromatch', '@mariozechner/pi-agent-core', '@mariozechner/pi-ai'],
  // Provide a real require() for bundled CJS modules (e.g. debug) that need Node.js builtins like tty
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Copy template files after build
  onSuccess: async () => {
    const srcTemplatesDir = path.join('src', 'templates');
    const distTemplatesDir = path.join('dist', 'templates');

    const repoRootDir = path.resolve('..', '..');
    const rootSkillsDir = path.join(repoRootDir, 'skills');

    // Copy entire templates directory structure recursively
    cpSync(srcTemplatesDir, distTemplatesDir, {
      recursive: true,
      filter: (src) => {
        // Skip index.ts and any TypeScript files
        return !src.endsWith('.ts');
      },
    });

    // Also copy agentv skills from repo root (source of truth)
    const distSkillsDir = path.join(distTemplatesDir, '.agents', 'skills');
    for (const skill of SKILLS_TO_INCLUDE) {
      const source = path.join(rootSkillsDir, skill);
      const target = path.join(distSkillsDir, skill);
      if (!existsSync(source)) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true });
    }

    console.log('✓ Template files copied to dist/templates');
  },
});
