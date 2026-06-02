import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: true,
  target: 'node20',
  tsconfig: './tsconfig.json',
  external: ['@agentv/core'],
});
