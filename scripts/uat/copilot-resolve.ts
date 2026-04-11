/**
 * UAT: verify `resolvePlatformCliPath()` finds a globally-installed Copilot CLI.
 *
 * Regression guard for #1036 — Windows users who install `@github/copilot`
 * globally via `npm install -g` should have the native binary resolved
 * automatically, without having to set `COPILOT_EXE` in their env.
 *
 * Run from OUTSIDE the repo (so the local node_modules walk-up cannot match
 * the bundled dev copy and mask a regression):
 *
 *   cd /tmp
 *   bun <path-to-repo>/scripts/uat/copilot-resolve.ts
 *
 * Expected (green):
 *   resolved: <absolute path to copilot[.exe]>
 *   exit 0
 *
 * Failure (red):
 *   resolved: undefined
 *   exit 1
 *
 * Prerequisite: `@github/copilot` must be globally installed, e.g.
 *   npm install -g @github/copilot
 */
import { resolvePlatformCliPath } from '../../packages/core/src/evaluation/providers/copilot-utils.js';

const resolved = resolvePlatformCliPath();
console.log('resolved:', resolved);
process.exit(resolved ? 0 : 1);
