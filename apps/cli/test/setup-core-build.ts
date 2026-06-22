/**
 * Pre-flight check for CLI integration tests.
 *
 * CLI integration tests depend on @agentv/core and @agentv/sdk being built
 * (they import from the dist output). Rather than building packages inside
 * the test — which is slow and hides staleness issues — we simply verify dist exists and
 * fail fast with a clear message if it doesn't.
 *
 * CI runs `bun run build` before `bun run test`, so dist is available in
 * the normal merge gate. For ad-hoc local runs, build first:
 *
 *   bun --filter @agentv/core build && bun --filter @agentv/sdk build && bun --filter agentv test
 */

import { constants, accessSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const distEntries = [
  ['@agentv/core', path.join(projectRoot, 'packages/core/dist/index.js')],
  ['@agentv/sdk', path.join(projectRoot, 'packages/sdk/dist/index.js')],
] as const;

export function assertCoreBuild(): void {
  for (const [packageName, distEntry] of distEntries) {
    try {
      accessSync(distEntry, constants.R_OK);
    } catch {
      throw new Error(
        `${packageName} is not built. Run \`bun --filter @agentv/core build && bun --filter @agentv/sdk build\` first.`,
      );
    }
  }
}
