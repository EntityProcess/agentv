import path from 'node:path';
import { command, flag, restPositionals, string } from 'cmd-ts';

import { scanRepoDeps } from '@agentv/core';

import { resolveEvalPaths } from '../eval/shared.js';

export const depsCommand = command({
  name: 'deps',
  description: 'Scan eval files and list git repo dependencies needed by workspaces',
  args: {
    evalPaths: restPositionals({
      type: string,
      displayName: 'eval-paths',
      description: 'Path(s) or glob(s) to evaluation .yaml file(s)',
    }),
    usedBy: flag({
      long: 'used-by',
      description: 'Include list of eval files that reference each repo',
    }),
  },
  handler: async ({ evalPaths, usedBy }) => {
    if (evalPaths.length === 0) {
      console.error('Usage: agentv workspace deps <eval-paths...>');
      process.exit(1);
    }

    const cwd = process.cwd();
    const resolvedPaths = await resolveEvalPaths(evalPaths, cwd);
    const result = await scanRepoDeps(resolvedPaths);

    for (const err of result.errors) {
      console.error(`error: ${path.relative(cwd, err.file)}: ${err.message}`);
    }
    if (result.errors.length > 0) {
      process.exit(1);
    }

    // Output JSON manifest to stdout (snake_case per wire format convention)
    const output = {
      repos: result.repos.map((r) => ({
        url: r.url,
        ...(r.ref !== undefined && { ref: r.ref }),
        ...(r.sparse !== undefined && { sparse: r.sparse }),
        ...(r.ancestor !== undefined && { ancestor: r.ancestor }),
        ...(usedBy && { used_by: r.usedBy.map((p) => path.relative(cwd, p)) }),
      })),
    };

    console.log(JSON.stringify(output, null, 2));
  },
});
