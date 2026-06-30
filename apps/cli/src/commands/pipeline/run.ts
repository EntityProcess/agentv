/**
 * `agentv pipeline run` — Combined command that runs input extraction, CLI target
 * invocation, and code grading in a single step.
 *
 * Equivalent to running:
 *   1. `agentv pipeline input <eval> --out <dir>`
 *   2. Invoking each CLI target in parallel (writing response.md + timing.json)
 *   3. `agentv pipeline grade <dir>`
 *
 * For `kind: agent` targets, step 2 is skipped (subagent handles execution).
 *
 * To add new features: extend the handler — all logic is self-contained.
 */
import { exec } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { deriveCategory, loadTestSuite } from '@agentv/core';
import type { CodeGraderConfig, GraderConfig, LlmGraderConfig } from '@agentv/core';
import { command, number, oneOf, option, optional, positional, string } from 'cmd-ts';

import { buildDefaultRunDir } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectTarget } from '../eval/targets.js';
import type { GraderTask } from './grade.js';
import { runCodeGraders } from './grade.js';

/**
 * Convert a Message[] array to plain text.
 * Single message: returns content directly (no role prefix).
 * Multiple messages: prefixes each with @role for clarity.
 */
function extractInputText(input: Array<{ role: string; content: string }>): string {
  if (!input || input.length === 0) return '';
  if (input.length === 1) return input[0].content;
  return input.map((m) => `@[${m.role}]:\n${m.content}`).join('\n\n');
}

/** Load key=value pairs from a .env file. Ignores comments and blank lines. */
function loadEnvFile(dir: string): Record<string, string> {
  let current = resolve(dir);
  while (true) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) {
      const env: Record<string, string> = {};
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
      return env;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return {};
}

export const evalRunCommand = command({
  name: 'run',
  description:
    'Extract inputs, invoke CLI targets, and run code graders (for agent targets, use pipeline input + subagents)',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to eval YAML file',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description: 'Output directory for results (default: .agentv/results/<run_id>)',
    }),
    workers: option({
      type: optional(number),
      long: 'workers',
      description: 'Parallel workers for target invocation (default: targets.yaml workers, then 5)',
    }),
    experiment: option({
      type: optional(string),
      long: 'experiment',
      description: 'Experiment label (e.g. with_skills, without_skills)',
    }),
    graderType: option({
      type: optional(oneOf(['code', 'none'])),
      long: 'grader-type',
      description:
        'Which grading phase to run: "code" runs code-graders inline, omit to skip grading (use pipeline grade separately)',
    }),
    target: option({
      type: optional(string),
      long: 'target',
      description: 'Override target name from targets.yaml (mirrors eval run --target)',
    }),
    targets: option({
      type: optional(string),
      long: 'targets',
      description: 'Path to targets.yaml (overrides discovery)',
    }),
  },
  handler: async ({ evalPath, out, workers, experiment, graderType, target, targets }) => {
    const resolvedEvalPath = resolve(evalPath);
    const outDir = resolve(out ?? buildDefaultRunDir(process.cwd(), experiment));
    const repoRoot = await findRepoRoot(dirname(resolvedEvalPath));
    const evalDir = dirname(resolvedEvalPath);

    // ── Step 1: Extract inputs (same as pipeline input) ──────────────
    const category = deriveCategory(relative(process.cwd(), resolvedEvalPath));
    const suite = await loadTestSuite(resolvedEvalPath, repoRoot, { category });
    const tests = suite.tests;

    if (tests.length === 0) {
      console.error('No tests found in eval file.');
      process.exit(1);
    }

    let targetInfo: {
      kind: 'cli';
      command: string;
      cwd: string;
      timeoutMs: number;
    } | null = null;
    let targetName = 'agent';
    let targetKind = 'agent';
    let targetWorkers: number | undefined;

    try {
      const selection = await selectTarget({
        testFilePath: resolvedEvalPath,
        repoRoot,
        cwd: evalDir,
        cliTargetName: target,
        explicitTargetsPath: targets,
        env: process.env,
      });
      targetName = selection.targetName;
      targetWorkers = selection.resolvedTarget.workers;
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
      // No targets file — subagent-as-target mode
    }

    // Use tests[0].suite — loaders (yaml-parser, jsonl-parser) already apply the
    // metadata.name → filename-basename → 'eval' fallback for subagent-mode labels.
    const suiteName = tests[0]?.suite?.trim() ?? '';
    const safeSuiteName = suiteName ? suiteName.replace(/[\/\\:*?"<>|]/g, '_') : '';

    const testIds: string[] = [];

    for (const test of tests) {
      const subpath = safeSuiteName ? [safeSuiteName, test.id] : [test.id];
      const testDir = join(outDir, ...subpath);
      await mkdir(testDir, { recursive: true });
      testIds.push(test.id);

      const inputMessages = test.input.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content,
      }));
      await writeJson(join(testDir, 'input.json'), {
        input: inputMessages,
        input_files: test.file_paths,
        metadata: test.metadata ?? {},
      });

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

      await writeFile(join(testDir, 'criteria.md'), test.criteria ?? '', 'utf8');

      if (
        test.expected_output.length > 0 ||
        (test.reference_answer !== undefined && test.reference_answer !== '')
      ) {
        await writeJson(join(testDir, 'expected_output.json'), {
          expected_output: test.expected_output,
          reference_answer: test.reference_answer ?? '',
        });
      }

      await writeGraderConfigs(testDir, test.assertions ?? [], evalDir);
    }

    await writeJson(join(outDir, 'manifest.json'), {
      eval_file: resolvedEvalPath,
      suite: suiteName || undefined,
      experiment: experiment || undefined,
      timestamp: new Date().toISOString(),
      target: { name: targetName, kind: targetKind },
      test_ids: testIds,
    });

    console.log(`Extracted ${testIds.length} test(s) to ${outDir}`);

    // ── Step 2: Invoke CLI targets in parallel ───────────────────────
    if (targetInfo) {
      const envVars = loadEnvFile(evalDir);
      // Set AGENTV_RUN_* so CLI targets group artifacts under this run folder.
      if (!process.env.AGENTV_RUN_TIMESTAMP) {
        process.env.AGENTV_RUN_TIMESTAMP = new Date()
          .toISOString()
          .replace(/:/g, '-')
          .replace(/\./g, '-');
      }
      const mergedEnv = { ...process.env, ...envVars, AGENTV_RUN_DIR: outDir };
      const maxWorkers = workers ?? targetWorkers ?? 5;
      let invCompleted = 0;
      const invTotal = testIds.length;

      const writeInvProgress = () => {
        process.stderr.write(`\rInvoking: ${invCompleted}/${invTotal} done`);
      };

      console.log(`Invoking ${invTotal} CLI target(s) (${maxWorkers} workers)...`);
      writeInvProgress();

      const invokeTarget = async (testId: string): Promise<void> => {
        const subpath = safeSuiteName ? [safeSuiteName, testId] : [testId];
        const testDir = join(outDir, ...subpath);
        const invoke = JSON.parse(await readFile(join(testDir, 'invoke.json'), 'utf8'));
        if (invoke.kind !== 'cli') return;

        const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));
        const template: string = invoke.command;
        const cwd: string = invoke.cwd;
        const timeoutMs: number = invoke.timeout_ms ?? 120000;

        // Write temp prompt file
        const promptFile = join(tmpdir(), `agentv-prompt-${testId}-${Date.now()}.txt`);
        const outputFile = join(tmpdir(), `agentv-output-${testId}-${Date.now()}.txt`);
        const inputText = extractInputText(inputData.input);
        await writeFile(promptFile, inputText, 'utf8');

        let rendered = template;
        rendered = rendered.replace('{PROMPT_FILE}', promptFile);
        rendered = rendered.replace('{OUTPUT_FILE}', outputFile);
        rendered = rendered.replace('{PROMPT}', inputText);

        const start = performance.now();
        try {
          await new Promise<void>((resolveP, rejectP) => {
            exec(
              rendered,
              {
                cwd,
                timeout: timeoutMs,
                env: mergedEnv,
                maxBuffer: 10 * 1024 * 1024,
              },
              (error) => {
                if (error) rejectP(error);
                else resolveP();
              },
            );
          });
          const durationMs = Math.round(performance.now() - start);

          let response: string;
          if (existsSync(outputFile)) {
            response = readFileSync(outputFile, 'utf8');
          } else {
            response = 'ERROR: No output file generated';
          }

          await writeFile(join(testDir, 'response.md'), response, 'utf8');
          await writeJson(join(testDir, 'timing.json'), {
            duration_ms: durationMs,
            total_duration_seconds: Math.round(durationMs / 10) / 100,
            execution_status: 'ok',
          });

          process.stderr.write(`\n  ${testId}: OK (${durationMs}ms, ${response.length} chars)\n`);
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);
          const message = error instanceof Error ? error.message : String(error);
          const response = `ERROR: target failed — ${message}`;
          await writeFile(join(testDir, 'response.md'), response, 'utf8');
          await writeJson(join(testDir, 'timing.json'), {
            duration_ms: durationMs,
            total_duration_seconds: Math.round(durationMs / 10) / 100,
            execution_status: 'execution_error',
          });
          process.stderr.write(
            `\n  ${testId}: FAILED (${durationMs}ms) — ${message.slice(0, 200)}\n`,
          );
        } finally {
          invCompleted++;
          writeInvProgress();
          // Cleanup temp files
          try {
            if (existsSync(promptFile)) unlinkSync(promptFile);
            if (existsSync(outputFile)) unlinkSync(outputFile);
          } catch {
            /* ignore cleanup errors */
          }
        }
      };

      // Run targets with concurrency limit
      const pending = new Set<Promise<void>>();
      for (const testId of testIds) {
        const task = invokeTarget(testId).then(() => {
          pending.delete(task);
        });
        pending.add(task);
        if (pending.size >= maxWorkers) {
          await Promise.race(pending);
        }
      }
      await Promise.all(pending);
      process.stderr.write('\n');
    } else {
      console.log('Subagent-as-target mode — the agent IS the target.');
      console.log('');
      console.log('  What happened: pipeline extracted inputs but did NOT invoke a CLI target.');
      console.log(
        '  The orchestrating agent must dispatch executor subagents to process each test.',
      );
      console.log('');
      console.log('  Next steps:');
      console.log('  1. Dispatch executor subagents — one per test case (all in parallel):');
      console.log('     - Each reads <run-dir>/<test-id>/input.json');
      console.log('     - Executes the task, writes <run-dir>/<test-id>/response.md');
      console.log('  2. Run code graders:   agentv pipeline grade <run-dir>');
      console.log(
        '  3. Dispatch grader subagents — one per (test x LLM grader) pair (all in parallel):',
      );
      console.log(
        '     - Read agents/grader.md and embed its content as system instructions in each subagent prompt',
      );
      console.log('     - Each subagent reads llm_graders/<name>.json + response.md');
      console.log('     - Each writes llm_grader_results/<name>.json');
      console.log('  4. Merge scores:       agentv pipeline bench <run-dir>');
      console.log('');
      console.log('  For the full procedure:');
      console.log('    agentv skills get agentv-bench --ref subagent-pipeline');
      console.log('');
    }

    // ── Step 3: Run code graders (only when explicitly requested) ─────
    if (graderType !== 'code') {
      console.log(`\nDone. Results in ${outDir}`);
      console.log('');
      if (targetKind === 'agent') {
        console.log('  The agent must now:');
        console.log('  1. Dispatch executor subagents to generate response.md files');
        console.log('  2. Run code graders:   agentv pipeline grade <run-dir>');
        console.log('  3. Dispatch grader subagents for llm_graders/ configs');
        console.log('  4. Merge scores:       agentv pipeline bench <run-dir>');
      } else {
        console.log('  To run code graders: agentv pipeline grade <run-dir>');
        console.log('  Or re-run with --grader-type code to grade inline.');
      }
      return;
    }

    // Collect grader tasks and run concurrently with progress feedback
    const graderTasks: GraderTask[] = [];

    for (const testId of testIds) {
      const subpath = safeSuiteName ? [safeSuiteName, testId] : [testId];
      const testDir = join(outDir, ...subpath);
      const codeGradersDir = join(testDir, 'code_graders');
      const resultsDir = join(testDir, 'code_grader_results');

      let graderFiles: string[];
      try {
        graderFiles = (await readdir(codeGradersDir)).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      if (graderFiles.length === 0) continue;
      await mkdir(resultsDir, { recursive: true });

      const responseText = await readFile(join(testDir, 'response.md'), 'utf8');
      const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));

      for (const graderFile of graderFiles) {
        graderTasks.push({ testId, testDir, resultsDir, graderFile, responseText, inputData });
      }
    }

    const graderConcurrency = workers ?? 10;
    const { totalGraders, totalPassed } = await runCodeGraders(graderTasks, graderConcurrency);
    console.log(`Graded ${totalGraders} code-grader(s): ${totalPassed} passed`);
    console.log('');
    console.log(`Results in ${outDir}`);
    console.log('');
    console.log('  Remaining steps:');
    console.log('  1. If llm_graders/ configs exist, dispatch grader subagents');
    console.log(
      '     - Read agents/grader.md, embed as system instructions in each subagent prompt',
    );
    console.log('  2. Merge all scores: agentv pipeline bench <run-dir>');
  },
});

// ── Helpers (shared with input.ts) ──────────────────────────────────

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeGraderConfigs(
  testDir: string,
  assertions: readonly GraderConfig[],
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
      const config = assertion as CodeGraderConfig;
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
      const config = assertion as LlmGraderConfig;
      let promptContent = '';
      if (config.resolvedPromptPath) {
        try {
          promptContent = readFileSync(config.resolvedPromptPath, 'utf8');
        } catch {
          promptContent = typeof config.prompt === 'string' ? config.prompt : '';
        }
      } else if (typeof config.prompt === 'string') {
        promptContent = config.prompt;
      }
      // For rubrics assertions, include the criteria array directly
      const rubrics = (config as LlmGraderConfig).rubrics;
      const rubricsData = rubrics?.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        weight: r.weight ?? 1.0,
        ...(r.score_ranges ? { score_range: r.score_ranges } : {}),
        ...(r.required !== undefined ? { required: r.required } : {}),
        ...(r.required_min_score !== undefined ? { required_min_score: r.required_min_score } : {}),
      }));

      await writeJson(join(llmGradersDir, `${config.name}.json`), {
        name: config.name,
        prompt_content: promptContent,
        ...(rubricsData && rubricsData.length > 0 ? { rubrics: rubricsData } : {}),
        weight: config.weight ?? 1.0,
        threshold: 0.5,
        config: {},
      });
    }
  }
}
