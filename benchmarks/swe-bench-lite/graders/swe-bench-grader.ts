#!/usr/bin/env bun
/**
 * SWE-bench Grader for AgentV
 *
 * A code-grader that evaluates agent patches against SWE-bench test suites.
 * Runs inside the Docker container via `docker exec` (handled by Docker workspace provider).
 *
 * Flow:
 * 1. Receives agent output (patch/diff) via stdin payload
 * 2. Applies the patch to the repository at /testbed
 * 3. Runs the FAIL_TO_PASS tests
 * 4. Checks which failing tests now pass
 * 5. Returns structured score + assertions
 *
 * Config (from EVAL.yaml):
 *   instance_id: SWE-bench instance identifier
 *   repo: Repository name (e.g. "django/django")
 *   base_commit: Base commit hash
 *   fail_to_pass: Array of test names that must transition from fail → pass
 *   pass_to_pass_count: Number of tests that must remain passing
 */

import { execSync } from 'node:child_process';
import { defineCodeGrader } from '@agentv/eval';

interface SWEBenchConfig {
  instance_id: string;
  repo: string;
  base_commit: string;
  fail_to_pass: string[];
  pass_to_pass_count: number;
}

function runCommand(
  cmd: string,
  cwd = '/testbed',
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: 300_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
      exitCode: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

export default defineCodeGrader(async ({ output, config }) => {
  const swebenchConfig = config as unknown as SWEBenchConfig;
  const { instance_id, fail_to_pass } = swebenchConfig;

  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  // Extract the patch from agent output
  const agentOutput = output?.map((m) => String(m.content ?? '')).join('\n') ?? '';

  // Extract diff content (unified diff format)
  const diffMatch = agentOutput.match(/^(---|\+\+\+|diff --git)[\s\S]*$/m);
  const patch = diffMatch ? diffMatch[0] : agentOutput;

  if (!patch.trim()) {
    return {
      score: 0,
      assertions: [
        {
          text: 'Agent produced a patch',
          passed: false,
          evidence: 'No patch content found in agent output',
        },
      ],
    };
  }

  assertions.push({
    text: 'Agent produced a patch',
    passed: true,
    evidence: `Patch length: ${patch.length} chars`,
  });

  // Step 1: Write patch to a temp file and apply it
  const patchPath = '/tmp/agent-patch.diff';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(patchPath, patch);

  const applyResult = runCommand(`git apply --verbose ${patchPath}`);
  const patchApplied = applyResult.exitCode === 0;

  if (!patchApplied) {
    // Try with --3way as fallback
    const apply3way = runCommand(`git apply --3way ${patchPath}`);
    if (apply3way.exitCode !== 0) {
      assertions.push({
        text: 'Patch applies cleanly',
        passed: false,
        evidence: `git apply failed: ${applyResult.stderr.slice(0, 500)}`,
      });
      return { score: 0, assertions, metadata: { instance_id, patch_length: patch.length } };
    }
  }
  assertions.push({ text: 'Patch applies cleanly', passed: true });

  // Step 2: Run FAIL_TO_PASS tests
  let passedCount = 0;
  for (const testName of fail_to_pass) {
    const testResult = runCommand(`python -m pytest ${testName} -x --tb=short -q 2>&1 || true`);
    const passed = testResult.stdout.includes(' passed') && !testResult.stdout.includes(' failed');

    assertions.push({
      text: `FAIL→PASS: ${testName}`,
      passed,
      evidence: passed
        ? 'Test now passes after patch'
        : `Test still fails: ${testResult.stdout.slice(0, 300)}`,
    });

    if (passed) passedCount++;
  }

  // Score: proportion of FAIL_TO_PASS tests that now pass
  const score = fail_to_pass.length > 0 ? passedCount / fail_to_pass.length : 0;

  return {
    score,
    assertions,
    metadata: {
      instance_id,
      patch_length: patch.length,
      fail_to_pass_total: fail_to_pass.length,
      fail_to_pass_resolved: passedCount,
    },
  };
});
