import { cpSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  dts: false,
  target: "node20",
  platform: "node",
  tsconfig: "./tsconfig.build.json",
  // Bundle @agentv/core but keep micromatch external (it has dynamic requires)
  noExternal: [/^@agentv\//],
  external: ["micromatch"],
  // Copy template files after build
  onSuccess: async () => {
    const srcTemplatesDir = path.join("src", "templates");
    const distTemplatesDir = path.join("dist", "templates");

    // Copy entire templates directory structure recursively
    cpSync(srcTemplatesDir, distTemplatesDir, {
      recursive: true,
      filter: (src) => {
        // Skip index.ts and any TypeScript files
        return !src.endsWith(".ts");
      },
    });

    console.log("✓ Template files copied to dist/templates");
  },
});
