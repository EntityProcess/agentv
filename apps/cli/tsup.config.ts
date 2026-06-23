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
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-coding-agent',
    '@github/copilot-sdk',
    '@openai/codex-sdk',
    '@anthropic-ai/claude-agent-sdk',
    'ai',
    '@ai-sdk/openai',
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

    // Copy bundled skills from <repo-root>/skills-data/ → dist/skills/.
    // `skills-data/` at the repo root is the source of truth for full skill
    // content (mirrors agent-browser's top-level `skill-data/` layout); the
    // marketplace plugin files (plugins/agentv-dev/skills/) are stubs that
    // redirect agents to `agentv skills get <name>`.
    const srcSkillsDir = path.resolve('..', '..', 'skills-data');
    const distSkillsDir = path.join('dist', 'skills');
    rmSync(distSkillsDir, { recursive: true, force: true });
    if (existsSync(srcSkillsDir)) {
      cpSync(srcSkillsDir, distSkillsDir, { recursive: true });
      console.log('✓ Skills copied to dist/skills');
    } else {
      console.log('⚠ Skills source not found at', srcSkillsDir, '— skipping');
    }

    // Copy dashboard SPA dist if available (built by apps/dashboard)
    const studioDistDir = path.resolve('..', 'dashboard', 'dist');
    const cliStudioDir = path.join('dist', 'dashboard');
    if (existsSync(studioDistDir)) {
      rmSync(cliStudioDir, { recursive: true, force: true });
      cpSync(studioDistDir, cliStudioDir, { recursive: true });
      console.log('✓ Dashboard dist copied to dist/dashboard');
    } else {
      console.log('⚠ Dashboard dist not found at', studioDistDir, '— skipping');
    }
  },
});
