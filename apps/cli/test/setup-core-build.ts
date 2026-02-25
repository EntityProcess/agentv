/**
 * Pre-flight check for CLI integration tests.
 *
 * CLI integration tests depend on @agentv/core being built (they import
 * from the dist output). Rather than building core inside the test — which
 * is slow and hides staleness issues — we simply verify dist exists and
 * fail fast with a clear message if it doesn't.
 *
 * The pre-push hook runs `bun run build` before `bun run test`, so dist
 * is always available in the normal workflow. For ad-hoc runs, build first:
 *
 *   bun run --filter @agentv/core build && bun --filter agentv test
 */

import { constants, accessSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const coreDistEntry = path.join(projectRoot, 'packages/core/dist/index.js');

export function assertCoreBuild(): void {
  try {
    accessSync(coreDistEntry, constants.R_OK);
  } catch {
    throw new Error('@agentv/core is not built. Run `bun run --filter @agentv/core build` first.');
  }
}
