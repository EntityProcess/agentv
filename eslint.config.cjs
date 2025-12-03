const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  {
    ignores: [
      "node_modules",
      ".pnpm-store",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "dist",
      "build",
      "out",
      ".next",
      "coverage",
      ".turbo",
      ".cache",
      "**/generated/**",
      "**/__generated__/**",
      "**/_codegen/**",
      "**/openapi/**",
      "**/*.generated.*",
      "**/*.d.ts",
      "logs",
      "*.log",
    ],
  },
  ...compat
    .config({
      env: {
        es2022: true,
        node: true,
      },
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint", "import"],
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
        "prettier",
      ],
      settings: {
        "import/resolver": {
          typescript: {
            project: ["./tsconfig.eslint.json"],
          },
        },
      },
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "import/order": [
          "warn",
          {
            groups: [["builtin", "external"], ["internal"], ["parent", "sibling", "index"]],
            alphabetize: { order: "asc", caseInsensitive: true },
            "newlines-between": "always",
          },
        ],
      },
    })
    .map((config) => ({
      ...config,
      files: ["**/*.ts", "**/*.tsx"],
    })),
];
