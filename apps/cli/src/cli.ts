#!/usr/bin/env node
import { killAllTrackedChildren } from '@agentv/core';

import { runCli } from './index.js';

// Forward SIGINT/SIGTERM to spawned provider subprocesses before exiting.
// Without this, Studio's `child.kill('SIGTERM')` against the CLI orphans
// any in-flight `claude`/`codex`/`pi`/`copilot` subprocess. The partial
// `index.jsonl` is already row-by-row durable, so finished tests survive.
//
// First signal: kill children, exit with the conventional 128+signal code.
// Second signal within the same process: hard-exit so a hung child cannot
// trap the user.
let interrupted = false;
function installShutdown(signal: NodeJS.Signals, exitCode: number) {
  process.on(signal, () => {
    if (interrupted) {
      process.exit(1);
    }
    interrupted = true;
    killAllTrackedChildren('SIGTERM');
    // Defer exit one tick so SIGTERM has a chance to dispatch before the
    // event loop tears down.
    setTimeout(() => process.exit(exitCode), 50);
  });
}
installShutdown('SIGINT', 130);
installShutdown('SIGTERM', 143);

runCli()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  });
