import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { command, flag, option, optional, positional, string } from 'cmd-ts';

import { getOutputFilenames, transpileEvalYamlFile } from '@agentv/core';

export const transpileCommand = command({
  name: 'transpile',
  description: 'Convert an EVAL.yaml file to Agent Skills evals.json format',
  args: {
    input: positional({
      type: string,
      displayName: 'input',
      description: 'Path to EVAL.yaml file',
    }),
    outDir: option({
      type: optional(string),
      long: 'out-dir',
      short: 'd',
      description: 'Output directory (defaults to directory of input file)',
    }),
    stdout: flag({
      long: 'stdout',
      description: 'Write to stdout instead of file(s) (only valid for single-skill output)',
    }),
  },
  handler: async ({ input, outDir, stdout }) => {
    let result: ReturnType<typeof transpileEvalYamlFile>;
    try {
      result = transpileEvalYamlFile(path.resolve(input));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }

    // Print warnings
    for (const warning of result.warnings) {
      console.warn(`Warning: ${warning}`);
    }

    if (result.files.size === 0) {
      console.error('Error: No output produced (no tests found)');
      process.exit(1);
    }

    if (stdout) {
      if (result.files.size > 1) {
        console.error(
          'Error: --stdout is only valid when input produces a single evals.json (multi-skill input produces multiple files)',
        );
        process.exit(1);
      }
      const [file] = result.files.values();
      process.stdout.write(JSON.stringify(file, null, 2));
      process.stdout.write('\n');
      return;
    }

    const outputDir = outDir ? path.resolve(outDir) : path.dirname(path.resolve(input));
    const fileNames = getOutputFilenames(result);

    for (const [skill, evalsJson] of result.files) {
      const fileName = fileNames.get(skill) ?? 'evals.json';
      const outputPath = path.join(outputDir, fileName);
      writeFileSync(outputPath, `${JSON.stringify(evalsJson, null, 2)}\n`);
      console.log(`Transpiled to ${outputPath}`);
    }
  },
});
