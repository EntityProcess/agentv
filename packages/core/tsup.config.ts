import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/script-grader.ts',
    'src/evaluation/validation/index.ts',
    'src/evaluation/providers/sdk-child-runner.ts',
  ],
  format: ['esm', 'cjs'],
  shims: true,
  sourcemap: true,
  clean: true,
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  target: 'node20',
  tsconfig: './tsconfig.build.json',
  external: [
    '@anthropic-ai/claude-agent-sdk',
    '@github/copilot-sdk',
    '@openai/codex-sdk',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-ai',
  ],
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
