#!/usr/bin/env bun
/**
 * run-loop.ts
 *
 * Plans and executes iteration commands without owning evaluator execution.
 * Thin CLI entrypoint that calls src/run-loop.ts helper.
 */

import { planLoopCommands } from '../src/run-loop.js';
import { runCommand } from '../src/command-runner.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      'Usage: bun scripts/run-loop.ts --eval-path <path> --iterations <n> [--dry-run] [...extra-args]',
    );
    process.exit(1);
  }

  let evalPath: string | null = null;
  let iterations = 1;
  let dryRun = false;
  const extraArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eval-path' && i + 1 < args.length) {
      evalPath = args[i + 1];
      i++;
    } else if (args[i] === '--iterations' && i + 1 < args.length) {
      iterations = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else {
      extraArgs.push(args[i]);
    }
  }

  if (!evalPath) {
    console.error('Error: --eval-path is required');
    process.exit(1);
  }

  const plan = planLoopCommands({ evalPath, iterations, extraArgs });

  console.log(`Planned ${plan.iterations} iteration(s) for: ${plan.evalPath}\n`);

  if (dryRun) {
    console.log('DRY RUN - Commands that would be executed:\n');
    for (let i = 0; i < plan.commands.length; i++) {
      console.log(`[${i + 1}/${plan.iterations}] ${plan.commands[i].join(' ')}`);
    }
    return;
  }

  for (let i = 0; i < plan.commands.length; i++) {
    console.log(`\n=== Iteration ${i + 1}/${plan.iterations} ===`);
    console.log(`Running: ${plan.commands[i].join(' ')}\n`);

    const result = await runCommand(plan.commands[i]);

    if (result.stdout) {
      console.log(result.stdout);
    }

    if (result.stderr) {
      console.error(result.stderr);
    }

    if (result.exitCode !== 0) {
      console.error(`\nIteration ${i + 1} failed with exit code ${result.exitCode}`);
      process.exit(result.exitCode);
    }
  }

  console.log(`\n✓ All ${plan.iterations} iteration(s) completed successfully`);
}

main();
