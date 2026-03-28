/**
 * `agentv pipeline input` — Extract eval inputs, target invocation info, and grader
 * configurations for subagent-mode eval runs.
 *
 * Reads an eval YAML file and writes a structured export directory that agents
 * and Python wrapper scripts can consume without re-parsing YAML or resolving
 * file references.
 *
 * Export directory layout:
 *   <out-dir>/
 *   ├── manifest.json
 *   └── <eval-set>/              (omitted if eval.yaml has no name)
 *       └── <test-id>/
 *           ├── input.json
 *           ├── invoke.json
 *           ├── criteria.md
 *           ├── expected_output.json    (if present)
 *           ├── llm_graders/<name>.json
 *           └── code_graders/<name>.json
 */
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { CodeEvaluatorConfig, EvaluatorConfig, LlmGraderEvaluatorConfig } from '@agentv/core';
import { loadTestSuite } from '@agentv/core';
import { command, option, optional, positional, string } from 'cmd-ts';

import { buildDefaultRunDir } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectTarget } from '../eval/targets.js';

export const evalInputCommand = command({
  name: 'input',
  description: 'Extract eval inputs, target commands, and grader prompts for subagent-mode runs',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to eval YAML file',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description:
        'Output directory for extracted inputs (default: .agentv/results/runs/<timestamp>)',
    }),
  },
  handler: async ({ evalPath, out }) => {
    const resolvedEvalPath = resolve(evalPath);
    const outDir = resolve(out ?? buildDefaultRunDir(process.cwd()));
    const repoRoot = await findRepoRoot(dirname(resolvedEvalPath));
    const evalDir = dirname(resolvedEvalPath);

    const suite = await loadTestSuite(resolvedEvalPath, repoRoot);
    const tests = suite.tests;

    if (tests.length === 0) {
      console.error('No tests found in eval file.');
      process.exit(1);
    }

    // Try to resolve target for CLI invocation info
    let targetInfo: { kind: 'cli'; command: string; cwd: string; timeoutMs: number } | null = null;
    let targetName = 'agent';
    let targetKind = 'agent';

    try {
      const selection = await selectTarget({
        testFilePath: resolvedEvalPath,
        repoRoot,
        cwd: evalDir,
        dryRun: false,
        dryRunDelay: 0,
        dryRunDelayMin: 0,
        dryRunDelayMax: 0,
        env: process.env,
      });

      targetName = selection.targetName;

      if (selection.resolvedTarget.kind === 'cli') {
        targetKind = 'cli';
        const config = selection.resolvedTarget.config;
        targetInfo = {
          kind: 'cli',
          command: config.command,
          cwd: config.cwd ?? evalDir,
          timeoutMs: config.timeoutMs ?? 30000,
        };
      }
    } catch {
      // No targets file found — subagent-as-target mode
    }

    const evalSetName = suite.metadata?.name?.trim() ?? '';
    const safeEvalSet = evalSetName ? evalSetName.replace(/[\/\\:*?"<>|]/g, '_') : '';

    const testIds: string[] = [];

    for (const test of tests) {
      const subpath = safeEvalSet ? [safeEvalSet, test.id] : [test.id];
      const testDir = join(outDir, ...subpath);
      await mkdir(testDir, { recursive: true });
      testIds.push(test.id);

      // input.json
      const inputText = test.question;
      const inputMessages = test.input.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content,
      }));
      await writeJson(join(testDir, 'input.json'), {
        input_text: inputText,
        input_messages: inputMessages,
        file_paths: test.file_paths,
        metadata: test.metadata ?? {},
      });

      // invoke.json
      if (targetInfo) {
        await writeJson(join(testDir, 'invoke.json'), {
          kind: 'cli',
          command: targetInfo.command,
          cwd: targetInfo.cwd,
          timeout_ms: targetInfo.timeoutMs,
          env: {},
        });
      } else {
        await writeJson(join(testDir, 'invoke.json'), {
          kind: 'agent',
          instructions: 'Execute this task in the current workspace. The agent IS the target.',
        });
      }

      // criteria.md
      await writeFile(join(testDir, 'criteria.md'), test.criteria ?? '', 'utf8');

      // expected_output.json (if present)
      if (
        test.expected_output.length > 0 ||
        (test.reference_answer !== undefined && test.reference_answer !== '')
      ) {
        await writeJson(join(testDir, 'expected_output.json'), {
          expected_output: test.expected_output,
          reference_answer: test.reference_answer ?? '',
        });
      }

      // Grader configs
      await writeGraderConfigs(testDir, test.assertions ?? [], evalDir);
    }

    // manifest.json
    await writeJson(join(outDir, 'manifest.json'), {
      eval_file: resolvedEvalPath,
      eval_set: evalSetName || undefined,
      timestamp: new Date().toISOString(),
      target: {
        name: targetName,
        kind: targetKind,
      },
      test_ids: testIds,
    });

    console.log(`Extracted ${testIds.length} test(s) to ${outDir}`);
  },
});

async function writeGraderConfigs(
  testDir: string,
  assertions: readonly EvaluatorConfig[],
  evalDir: string,
): Promise<void> {
  const codeGradersDir = join(testDir, 'code_graders');
  const llmGradersDir = join(testDir, 'llm_graders');

  let hasCodeGraders = false;
  let hasLlmGraders = false;

  for (const assertion of assertions) {
    if (assertion.type === 'code-grader') {
      if (!hasCodeGraders) {
        await mkdir(codeGradersDir, { recursive: true });
        hasCodeGraders = true;
      }
      const config = assertion as CodeEvaluatorConfig;
      await writeJson(join(codeGradersDir, `${config.name}.json`), {
        name: config.name,
        command: config.command,
        cwd: config.resolvedCwd ?? config.cwd ?? evalDir,
        weight: config.weight ?? 1.0,
        config: config.config ?? {},
      });
    } else if (assertion.type === 'llm-grader') {
      if (!hasLlmGraders) {
        await mkdir(llmGradersDir, { recursive: true });
        hasLlmGraders = true;
      }
      const config = assertion as LlmGraderEvaluatorConfig;
      let promptContent = '';

      if (config.resolvedPromptPath) {
        try {
          promptContent = await readFile(config.resolvedPromptPath, 'utf8');
        } catch {
          promptContent = typeof config.prompt === 'string' ? config.prompt : '';
        }
      } else if (typeof config.prompt === 'string') {
        promptContent = config.prompt;
      }

      await writeJson(join(llmGradersDir, `${config.name}.json`), {
        name: config.name,
        prompt_content: promptContent,
        weight: config.weight ?? 1.0,
        threshold: 0.5,
        config: {},
      });
    }
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
