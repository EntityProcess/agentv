import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceScriptConfig } from '../../../src/evaluation/types.js';
import {
  type ScriptExecutionContext,
  executeWorkspaceSetup,
  executeWorkspaceTeardown,
} from '../../../src/evaluation/workspace/script-executor.js';

describe('Script Executor', () => {
  let testDir: string;
  let setupScript: string;
  let teardownScript: string;
  let failingScript: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `agentv-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Create a simple setup script that outputs to stdout and reads stdin
    setupScript = path.join(testDir, 'setup.js');
    await writeFile(
      setupScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  const context = JSON.parse(data);
  console.log('Setup completed for workspace:', context.workspace_path);
  console.log('Eval case:', context.eval_case_id);
  process.exit(0);
});
`,
    );

    // Create a simple teardown script
    teardownScript = path.join(testDir, 'teardown.js');
    await writeFile(
      teardownScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  const context = JSON.parse(data);
  console.log('Teardown completed for workspace:', context.workspace_path);
  process.exit(0);
});
`,
    );

    // Create a failing script
    failingScript = path.join(testDir, 'failing.js');
    await writeFile(
      failingScript,
      `
console.error('Script failed intentionally');
process.exit(1);
`,
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should execute setup script successfully', async () => {
    const config: WorkspaceScriptConfig = {
      script: ['node', setupScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'test-case-1',
      evalRunId: 'run-123',
    };

    const output = await executeWorkspaceSetup(config, context);
    expect(output).toContain('Setup completed');
    expect(output).toContain('/tmp/workspace');
    expect(output).toContain('test-case-1');
  });

  it('should execute teardown script successfully', async () => {
    const config: WorkspaceScriptConfig = {
      script: ['node', teardownScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'test-case-2',
      evalRunId: 'run-123',
    };

    const output = await executeWorkspaceTeardown(config, context);
    expect(output).toContain('Teardown completed');
    expect(output).toContain('/tmp/workspace');
  });

  it('should fail on setup script error', async () => {
    const config: WorkspaceScriptConfig = {
      script: ['node', failingScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'test-case-3',
      evalRunId: 'run-123',
    };

    await expect(executeWorkspaceSetup(config, context)).rejects.toThrow('Setup script failed');
  });

  it('should handle teardown script error gracefully (with warning)', async () => {
    const config: WorkspaceScriptConfig = {
      script: ['node', failingScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'test-case-4',
      evalRunId: 'run-123',
    };

    // Teardown should not throw, only warn
    const output = await executeWorkspaceTeardown(config, context);
    expect(output).toBeDefined();
  });

  it('should pass context via stdin as JSON', async () => {
    const contextCheckScript = path.join(testDir, 'check-context.js');
    await writeFile(
      contextCheckScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  try {
    const context = JSON.parse(data);
    if (context.workspace_path && context.eval_case_id && context.eval_run_id) {
      console.log('Context validated successfully');
      process.exit(0);
    }
    process.exit(1);
  } catch (e) {
    process.exit(2);
  }
});
`,
    );

    const config: WorkspaceScriptConfig = {
      script: ['node', contextCheckScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/home/test/workspace',
      testId: 'my-case',
      evalRunId: 'my-run',
    };

    const output = await executeWorkspaceSetup(config, context);
    expect(output).toContain('Context validated successfully');
  });

  it('should pass case metadata and input to setup script via stdin', async () => {
    const metadataCheckScript = path.join(testDir, 'check-metadata.js');
    await writeFile(
      metadataCheckScript,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let data = '';
rl.on('line', (line) => { data += line; });
rl.on('close', () => {
  try {
    const context = JSON.parse(data);
    if (context.case_input && context.case_metadata && context.case_metadata.repo) {
      console.log('Metadata received: ' + context.case_metadata.repo);
      console.log('Input received: ' + context.case_input.substring(0, 20));
      process.exit(0);
    }
    console.error('Missing fields');
    process.exit(1);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
});
`,
    );

    const config: WorkspaceScriptConfig = {
      script: ['node', metadataCheckScript],
      timeout_ms: 5000,
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'sympy-20590',
      evalRunId: 'run-123',
      caseInput: 'Fix the bug in issue #20590...',
      caseMetadata: { repo: 'sympy/sympy', base_commit: '9aabb237' },
    };

    const output = await executeWorkspaceSetup(config, context);
    expect(output).toContain('Metadata received: sympy/sympy');
    expect(output).toContain('Input received: Fix the bug in issue');
  });

  it('should support optional timeout_ms (defaults apply)', async () => {
    const config: WorkspaceScriptConfig = {
      script: ['node', setupScript],
      // No timeout_ms specified - should use default (60000 for setup)
    };

    const context: ScriptExecutionContext = {
      workspacePath: '/tmp/workspace',
      testId: 'test-case-5',
      evalRunId: 'run-123',
    };

    // Should complete successfully with default timeout
    const output = await executeWorkspaceSetup(config, context);
    expect(output).toBeDefined();
  });
});
