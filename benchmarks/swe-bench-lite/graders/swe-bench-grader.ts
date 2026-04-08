#!/usr/bin/env bun
/**
 * SWE-bench Grader for AgentV
 *
 * A code-grader that evaluates agent patches against SWE-bench test suites.
 * Runs inside the Docker container alongside the repository under test.
 *
 * Flow:
 * 1. Receives agent output (patch/diff) via stdin payload
 * 2. Applies the patch to the repository at /testbed
 * 3. Runs the test suite
 * 4. Checks FAIL_TO_PASS transitions (tests that should now pass)
 * 5. Returns structured score + assertions
 *
 * Config (from EVAL.yaml):
 *   instance_id: SWE-bench instance identifier
 *   repo: Repository name (e.g. "django/django")
 *   base_commit: Base commit hash
 *   fail_to_pass: Array of test names that must transition from fail → pass
 *   pass_to_pass_count: Number of tests that must remain passing
 */

import { defineCodeGrader } from '@agentv/eval';

interface SWEBenchConfig {
  instance_id: string;
  repo: string;
  base_commit: string;
  fail_to_pass: string[];
  pass_to_pass_count: number;
}

export default defineCodeGrader(async ({ output, config, workspacePath }) => {
  const swebenchConfig = config as unknown as SWEBenchConfig;
  const { instance_id, fail_to_pass } = swebenchConfig;

  // Extract the patch from agent output
  const agentOutput = output?.map((m) => String(m.content ?? '')).join('\n') ?? '';

  // Extract diff content from agent output (look for unified diff markers)
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

  // In Docker execution mode, AgentV handles:
  // 1. Writing the patch to /tmp/patch.diff inside the container
  // 2. The grader script runs inside the container with access to /testbed
  //
  // Here we simulate the grading logic that would run inside the container.
  // The actual container execution is handled by the Docker workspace provider.

  const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

  // Check 1: Agent produced a patch
  assertions.push({
    text: 'Agent produced a patch',
    passed: patch.length > 0,
    evidence: `Patch length: ${patch.length} characters`,
  });

  // Check 2: Patch applies cleanly (would be validated inside container)
  const hasDiffMarkers =
    patch.includes('diff --git') || patch.includes('---') || patch.includes('+++');
  assertions.push({
    text: 'Patch has valid diff format',
    passed: hasDiffMarkers,
    evidence: hasDiffMarkers ? 'Contains unified diff markers' : 'Missing diff markers',
  });

  // Check 3: FAIL_TO_PASS tests (the core SWE-bench metric)
  // In real execution, this would run pytest inside the container and check results.
  // The Docker workspace provider pipes the grader command into the container.
  //
  // For the grader template, we structure the assertions so the Docker provider
  // can populate them with real test results.
  for (const testName of fail_to_pass) {
    assertions.push({
      text: `FAIL→PASS: ${testName}`,
      passed: false, // Will be set by container execution
      evidence: 'Pending container execution',
    });
  }

  // Score: proportion of FAIL_TO_PASS tests that now pass
  const failToPassPassed = assertions.filter(
    (a) => a.text.startsWith('FAIL→PASS:') && a.passed,
  ).length;
  const score = fail_to_pass.length > 0 ? failToPassPassed / fail_to_pass.length : 0;

  return {
    score,
    assertions,
    metadata: {
      instance_id,
      patch_length: patch.length,
      fail_to_pass_total: fail_to_pass.length,
      fail_to_pass_resolved: failToPassPassed,
    },
  };
});
