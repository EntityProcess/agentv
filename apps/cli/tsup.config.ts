import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  dts: false,
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  tsconfig: "./tsconfig.build.json",
});
