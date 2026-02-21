import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/evaluation/validation/index.ts'],
  format: ['esm', 'cjs'],
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
    '@opentelemetry/api',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/semantic-conventions',
  ],
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});
