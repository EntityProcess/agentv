/**
 * `agentv pipeline run` — Combined command that runs input extraction, CLI target
 * invocation, and code grading in a single step.
 *
 * Equivalent to running:
 *   1. `agentv pipeline input <eval> --out <dir>`
 *   2. Invoking each CLI target in parallel (writing response.md + timing.json)
 *   3. `agentv pipeline grade <dir>`
 *
 * For `kind: agent` targets, steps 2 is skipped (agent handles execution).
 *
 * To add new features: extend the handler — all logic is self-contained.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { executeScript, loadTestSuite } from '@agentv/core';
import type { CodeEvaluatorConfig, EvaluatorConfig, LlmGraderEvaluatorConfig } from '@agentv/core';
import { command, number, option, optional, positional, string } from 'cmd-ts';

import { buildDefaultRunDir } from '../eval/result-layout.js';
import { findRepoRoot } from '../eval/shared.js';
import { selectTarget } from '../eval/targets.js';

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
  description: 'Extract inputs, invoke CLI targets, and run code graders in one step',
  args: {
    evalPath: positional({
      type: string,
      displayName: 'eval-path',
      description: 'Path to eval YAML file',
    }),
    out: option({
      type: optional(string),
      long: 'out',
      description: 'Output directory for results (default: .agentv/results/runs/eval_<timestamp>)',
    }),
    workers: option({
      type: optional(number),
      long: 'workers',
      description: 'Parallel workers for target invocation (default: all tests)',
    }),
  },
  handler: async ({ evalPath, out, workers }) => {
    const resolvedEvalPath = resolve(evalPath);
    const outDir = resolve(out ?? buildDefaultRunDir(process.cwd()));
    const repoRoot = await findRepoRoot(dirname(resolvedEvalPath));
    const evalDir = dirname(resolvedEvalPath);

    // ── Step 1: Extract inputs (same as pipeline input) ──────────────
    const suite = await loadTestSuite(resolvedEvalPath, repoRoot);
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
      // No targets file — agent-as-target mode
    }

    const testIds: string[] = [];

    for (const test of tests) {
      const testDir = join(outDir, test.id);
      await mkdir(testDir, { recursive: true });
      testIds.push(test.id);

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
      timestamp: new Date().toISOString(),
      target: { name: targetName, kind: targetKind },
      test_ids: testIds,
    });

    console.log(`Extracted ${testIds.length} test(s) to ${outDir}`);

    // ── Step 2: Invoke CLI targets in parallel ───────────────────────
    if (targetInfo) {
      const envVars = loadEnvFile(evalDir);
      // Set AGENTV_RUN_TIMESTAMP so CLI targets group artifacts under one run folder.
      if (!process.env.AGENTV_RUN_TIMESTAMP) {
        process.env.AGENTV_RUN_TIMESTAMP = new Date()
          .toISOString()
          .replace(/:/g, '-')
          .replace(/\./g, '-');
      }
      const mergedEnv = { ...process.env, ...envVars };
      const maxWorkers = workers ?? testIds.length;

      console.log(`Invoking ${testIds.length} CLI target(s) (${maxWorkers} workers)...`);

      const invokeTarget = async (testId: string): Promise<void> => {
        const testDir = join(outDir, testId);
        const invoke = JSON.parse(await readFile(join(testDir, 'invoke.json'), 'utf8'));
        if (invoke.kind !== 'cli') return;

        const inputData = JSON.parse(await readFile(join(testDir, 'input.json'), 'utf8'));
        const template: string = invoke.command;
        const cwd: string = invoke.cwd;
        const timeoutMs: number = invoke.timeout_ms ?? 120000;

        // Write temp prompt file
        const promptFile = join(tmpdir(), `agentv-prompt-${testId}-${Date.now()}.txt`);
        const outputFile = join(tmpdir(), `agentv-output-${testId}-${Date.now()}.txt`);
        await writeFile(promptFile, inputData.input_text, 'utf8');

        let rendered = template;
        rendered = rendered.replace('{PROMPT_FILE}', promptFile);
        rendered = rendered.replace('{OUTPUT_FILE}', outputFile);
        rendered = rendered.replace('{PROMPT}', inputData.input_text);

        const start = performance.now();
        try {
          execSync(rendered, {
            cwd,
            timeout: timeoutMs,
            env: mergedEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
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

          console.log(`  ${testId}: OK (${durationMs}ms, ${response.length} chars)`);
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
          console.error(`  ${testId}: FAILED (${durationMs}ms) — ${message.slice(0, 200)}`);
        } finally {
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
    } else {
      console.log('Agent-as-target mode — skipping CLI invocation.');
    }

    // ── Step 3: Run code graders (same as pipeline grade) ────────────
    let totalGraders = 0;
    let totalPassed = 0;

    for (const testId of testIds) {
      const testDir = join(outDir, testId);
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
        const graderConfig = JSON.parse(await readFile(join(codeGradersDir, graderFile), 'utf8'));
        const graderName = graderConfig.name;

        const payload = JSON.stringify({
          output: [{ role: 'assistant', content: responseText }],
          input: inputData.input_messages,
          question: inputData.input_text,
          criteria: '',
          expected_output: [],
          reference_answer: '',
          input_files: [],
          trace: null,
          token_usage: null,
          cost_usd: null,
          duration_ms: null,
          start_time: null,
          end_time: null,
          file_changes: null,
          workspace_path: null,
          config: graderConfig.config ?? null,
          metadata: {},
          input_text: inputData.input_text,
          output_text: responseText,
          expected_output_text: '',
        });

        try {
          const stdout = await executeScript(
            graderConfig.command,
            payload,
            undefined,
            graderConfig.cwd,
          );
          const parsed = JSON.parse(stdout);
          const score = typeof parsed.score === 'number' ? parsed.score : 0;
          const assertions = Array.isArray(parsed.assertions) ? parsed.assertions : [];

          await writeFile(
            join(resultsDir, `${graderName}.json`),
            `${JSON.stringify(
              {
                name: graderName,
                type: 'code-grader',
                score,
                weight: graderConfig.weight ?? 1.0,
                assertions,
                details: parsed.details ?? {},
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
          totalGraders++;
          if (score >= 0.5) totalPassed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`  ${testId}/${graderName}: ERROR — ${message}`);
          await writeFile(
            join(resultsDir, `${graderName}.json`),
            `${JSON.stringify(
              {
                name: graderName,
                type: 'code-grader',
                score: 0,
                weight: graderConfig.weight ?? 1.0,
                assertions: [{ text: `Error: ${message}`, passed: false }],
                details: { error: message },
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
          totalGraders++;
        }
      }
    }

    console.log(`Graded ${totalGraders} code-grader(s): ${totalPassed} passed`);
    console.log(`\nDone. Agent can now perform LLM grading on responses in ${outDir}`);
  },
});

// ── Helpers (shared with input.ts) ──────────────────────────────────

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

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
          promptContent = readFileSync(config.resolvedPromptPath, 'utf8');
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
