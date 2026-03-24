# Agent-Mode Bench Scripts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship 3 new CLI subcommands (`eval input`, `eval grade`, `eval bench`) and Python wrapper scripts so agent-mode eval runs spend tokens only on LLM grading, not on plumbing.

**Architecture:** Add CLI subcommands that break the monolithic `eval run` pipeline into discrete steps. Python scripts in the bench skill call these CLI subcommands. The agent invokes the Python scripts, does LLM grading between steps, and produces final artifacts.

**Tech Stack:** TypeScript (CLI, cmd-ts), Python 3.11+ stdlib (wrapper scripts), Zod (validation)

**Issue:** https://github.com/EntityProcess/agentv/issues/735

---

## Working Environment

**Worktree:** `agentv.worktrees/feat/735-agent-mode-bench-scripts`
**Branch:** `feat/735-agent-mode-bench-scripts`

Setup:
```bash
git worktree add agentv.worktrees/feat/735-agent-mode-bench-scripts -b feat/735-agent-mode-bench-scripts
cd agentv.worktrees/feat/735-agent-mode-bench-scripts
bun install
cp /home/christso/projects/agentv/.env .env
```

**Draft PR:** Create immediately after first commit, before any implementation:
```bash
git push -u origin feat/735-agent-mode-bench-scripts
gh pr create --draft --title "feat(cli): agent-mode eval pipeline (eval input/grade/bench)" --body "Closes #735"
```

**Push regularly:** After every task commit, push to the draft PR so progress is visible:
```bash
git push
```

---

## Export Directory Structure

All three CLI subcommands operate on a shared export directory:

```
<out-dir>/
├── manifest.json                     ← Written by `eval input`
├── index.jsonl                       ← Written by `eval bench`
├── benchmark.json                    ← Written by `eval bench`
├── <test-id>/
│   ├── input.json                    ← Written by `eval input`
│   ├── invoke.json                   ← Written by `eval input`
│   ├── criteria.md                   ← Written by `eval input`
│   ├── expected_output.json          ← Written by `eval input` (if present)
│   ├── llm_graders/
│   │   └── <name>.json               ← Written by `eval input` (prompt content + config)
│   ├── code_graders/
│   │   └── <name>.json               ← Written by `eval input` (command + config)
│   ├── response.md                   ← Written by agent/script after target execution
│   ├── timing.json                   ← Written by agent/script (optional)
│   ├── code_grader_results/
│   │   └── <name>.json               ← Written by `eval grade`
│   └── grading.json                  ← Written by `eval bench`
```

## Data Contracts

### manifest.json (written by `eval input`)

```json
{
  "eval_file": "path/to/eval.yaml",
  "timestamp": "2026-03-24T10:30:00Z",
  "target": {
    "name": "echo-target",
    "kind": "cli"
  },
  "test_ids": ["test-01", "test-02"]
}
```

### input.json (per test, written by `eval input`)

```json
{
  "input_text": "hello world",
  "input_messages": [{"role": "user", "content": "hello world"}],
  "file_paths": [],
  "metadata": {}
}
```

### invoke.json (per test, written by `eval input`)

For CLI targets:
```json
{
  "kind": "cli",
  "command": "bun targets/echo-target.ts {PROMPT_FILE} {OUTPUT_FILE}",
  "cwd": "/path/to/eval/dir",
  "timeout_ms": 30000,
  "env": {}
}
```

For non-CLI targets (agent-as-target):
```json
{
  "kind": "agent",
  "instructions": "Execute this task in the current workspace. The agent IS the target."
}
```

### llm_graders/<name>.json (per test, written by `eval input`)

```json
{
  "name": "relevance",
  "prompt_content": "Full resolved prompt text from the .md file...",
  "weight": 2.0,
  "threshold": 0.5,
  "config": {}
}
```

### code_graders/<name>.json (per test, written by `eval input`)

```json
{
  "name": "contains_hello",
  "command": ["bun", "graders/contains.ts"],
  "cwd": "/path/to/eval/dir",
  "weight": 1.0,
  "config": {}
}
```

### code_grader_results/<name>.json (per test, written by `eval grade`)

```json
{
  "name": "contains_hello",
  "type": "code-grader",
  "score": 1.0,
  "weight": 1.0,
  "assertions": [{"text": "Found hello", "passed": true}],
  "details": {}
}
```

### LLM scores stdin format (consumed by `eval bench`)

```json
{
  "test-01": {
    "relevance": {
      "score": 0.85,
      "assertions": [{"text": "Response is relevant", "passed": true, "evidence": "..."}]
    }
  },
  "test-02": {
    "relevance": {
      "score": 0.0,
      "assertions": [{"text": "Response is relevant", "passed": false, "evidence": "..."}]
    }
  }
}
```

---

## Task 1: Create `agentv eval input` subcommand

**Files:**
- Create: `apps/cli/src/commands/eval/commands/input.ts`
- Modify: `apps/cli/src/commands/eval/index.ts` (register new subcommand)
- Test: `apps/cli/src/commands/eval/commands/__tests__/input.test.ts`

### Step 1: Write the test

```typescript
// apps/cli/src/commands/eval/commands/__tests__/input.test.ts
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';

const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__');
const OUT_DIR = join(import.meta.dirname, '__tmp_input_test__');

// Use a minimal eval fixture
const EVAL_PATH = join(FIXTURE_DIR, 'input-test.eval.yaml');

describe('eval input', () => {
  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes manifest.json with test_ids and eval_file', async () => {
    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.test_ids).toEqual(['test-01']);
    expect(manifest.eval_file).toContain('input-test.eval.yaml');
  });

  it('writes per-test input.json with input_text', async () => {
    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const input = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'input.json'), 'utf8'));
    expect(input.input_text).toBe('hello world');
    expect(input.input_messages).toHaveLength(1);
  });

  it('writes code_graders/<name>.json with resolved command', async () => {
    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const grader = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_graders', 'contains_hello.json'), 'utf8'),
    );
    expect(grader.command).toBeDefined();
    expect(grader.name).toBe('contains_hello');
  });

  it('writes llm_graders/<name>.json with resolved prompt content', async () => {
    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'input', EVAL_PATH, '--out', OUT_DIR]);

    const grader = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'llm_graders', 'relevance.json'), 'utf8'),
    );
    expect(grader.prompt_content).toBeDefined();
    expect(grader.name).toBe('relevance');
  });
});
```

### Step 2: Create a test fixture

Create `apps/cli/src/commands/eval/commands/__fixtures__/input-test.eval.yaml`:

```yaml
name: input-test
tests:
  - id: test-01
    input: hello world
    criteria: Response echoes the input
    assertions:
      - name: contains_hello
        type: code-grader
        command: echo '{"score":1}'
        weight: 1.0
      - name: relevance
        type: llm-grader
        prompt: Did the response echo the input?
        weight: 2.0
```

### Step 3: Run tests to verify they fail

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/input.test.ts
```

Expected: FAIL (command not found / module not found)

### Step 4: Implement `eval input` subcommand

Create `apps/cli/src/commands/eval/commands/input.ts`:

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { command, option, positional, string } from 'cmd-ts';

import { loadTestSuite } from '@agentv/core/evaluation/yaml-parser';
import { parseEvaluators } from '@agentv/core/evaluation/loaders/evaluator-parser';
import { findRepoRoot } from '../../repo-root.js';
import { selectTarget } from '../targets.js';

export const evalInputCommand = command({
  name: 'input',
  description: 'Extract eval inputs, target commands, and grader prompts for agent-mode runs',
  args: {
    evalPath: positional({ type: string, displayName: 'eval-path', description: 'Path to eval YAML file' }),
    out: option({ type: string, long: 'out', description: 'Output directory for extracted inputs' }),
  },
  handler: async ({ evalPath, out }) => {
    // Implementation — see step 4 detailed code below
  },
});
```

The handler implementation:

1. Resolve eval path and repo root
2. Call `loadTestSuite()` to parse the YAML
3. Call `selectTarget()` to resolve the target
4. Call `parseEvaluators()` for each test to get evaluator configs
5. For each test:
   - Write `input.json` (input_text, input_messages, file_paths)
   - Write `invoke.json` (target command, cwd, timeout)
   - Write `criteria.md` (criteria text)
   - Write `expected_output.json` (if present)
   - For each code-grader assertion: write `code_graders/<name>.json`
   - For each llm-grader assertion: resolve prompt file, read content, write `llm_graders/<name>.json`
6. Write `manifest.json` (eval_file, timestamp, target, test_ids)

Key imports to use:
- `loadTestSuite` from `@agentv/core` — parses YAML, returns tests array
- `parseEvaluators` from `@agentv/core` — resolves assertion configs with file paths
- `selectTarget` from `../targets.js` — resolves target from targets.yaml
- `toSnakeCaseDeep` from `@agentv/core` — for wire format output

For LLM grader prompt resolution, read the `resolvedPromptPath` from the parsed evaluator config and read the file content. The evaluator parser already resolves relative paths.

### Step 5: Register the subcommand

Modify `apps/cli/src/commands/eval/index.ts`:

```typescript
import { evalInputCommand } from './commands/input.js';

export const evalCommand = subcommands({
  name: 'eval',
  description: 'Evaluation commands',
  cmds: {
    run: evalRunCommand,
    prompt: evalPromptCommand,
    assert: evalAssertCommand,
    input: evalInputCommand,
  },
});
```

### Step 6: Run tests to verify they pass

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/input.test.ts
```

Expected: PASS

### Step 7: Commit

```bash
git add apps/cli/src/commands/eval/commands/input.ts \
  apps/cli/src/commands/eval/commands/__tests__/input.test.ts \
  apps/cli/src/commands/eval/commands/__fixtures__/input-test.eval.yaml \
  apps/cli/src/commands/eval/index.ts
git commit -m "feat(cli): add eval input subcommand for agent-mode input extraction"
git push
```

---

## Task 2: Create `agentv eval grade` subcommand

**Files:**
- Create: `apps/cli/src/commands/eval/commands/grade.ts`
- Modify: `apps/cli/src/commands/eval/index.ts` (register)
- Test: `apps/cli/src/commands/eval/commands/__tests__/grade.test.ts`

### Step 1: Write the test

```typescript
// apps/cli/src/commands/eval/commands/__tests__/grade.test.ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_grade_test__');

describe('eval grade', () => {
  beforeEach(async () => {
    // Set up a minimal export directory with response.md and code_graders config
    const testDir = join(OUT_DIR, 'test-01');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeGradersDir, { recursive: true });

    await writeFile(join(testDir, 'response.md'), 'hello world');
    await writeFile(join(testDir, 'input.json'), JSON.stringify({
      input_text: 'say hello',
      input_messages: [{ role: 'user', content: 'say hello' }],
      file_paths: [],
    }));
    // Code grader that always passes (echo command)
    await writeFile(join(codeGradersDir, 'always_pass.json'), JSON.stringify({
      name: 'always_pass',
      command: ['bash', '-c', 'echo \'{"score":1,"assertions":[{"text":"pass","passed":true}]}\''],
      weight: 1.0,
    }));
    await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify({
      eval_file: 'test.eval.yaml',
      timestamp: new Date().toISOString(),
      target: { name: 'test', kind: 'cli' },
      test_ids: ['test-01'],
    }));
  });

  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes code_grader_results/<name>.json with score', async () => {
    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'grade', OUT_DIR]);

    const result = JSON.parse(
      await readFile(join(OUT_DIR, 'test-01', 'code_grader_results', 'always_pass.json'), 'utf8'),
    );
    expect(result.score).toBe(1);
    expect(result.name).toBe('always_pass');
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/grade.test.ts
```

### Step 3: Implement `eval grade` subcommand

Create `apps/cli/src/commands/eval/commands/grade.ts`:

The handler:

1. Read `manifest.json` from the export dir
2. For each test_id in manifest:
   - Read `response.md` as the candidate text
   - Read `input.json` for context
   - Read each `code_graders/<name>.json`
   - For each code grader, construct the stdin payload (same format as `CodeEvaluator` — snake_case JSON with `output_text`, `input_text`, `criteria`, etc.)
   - Execute the code grader command via `executeScript()` from `@agentv/core`
   - Parse the result
   - Write `code_grader_results/<name>.json`
3. Print summary to stdout

Key: reuse `executeScript()` from `packages/core/src/evaluation/evaluators/code-evaluator.ts` and `toSnakeCaseDeep()` for building the stdin payload. This ensures the code grader receives the exact same format it gets from `agentv eval run`.

### Step 4: Register the subcommand

Add to `apps/cli/src/commands/eval/index.ts`:

```typescript
import { evalGradeCommand } from './commands/grade.js';

// In cmds:
grade: evalGradeCommand,
```

### Step 5: Run tests to verify they pass

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/grade.test.ts
```

### Step 6: Commit

```bash
git add apps/cli/src/commands/eval/commands/grade.ts \
  apps/cli/src/commands/eval/commands/__tests__/grade.test.ts \
  apps/cli/src/commands/eval/index.ts
git commit -m "feat(cli): add eval grade subcommand for code-grader execution"
git push
```

---

## Task 3: Create `agentv eval bench` subcommand

**Files:**
- Create: `apps/cli/src/commands/eval/commands/bench.ts`
- Modify: `apps/cli/src/commands/eval/index.ts` (register)
- Test: `apps/cli/src/commands/eval/commands/__tests__/bench.test.ts`

### Step 1: Write the test

```typescript
// apps/cli/src/commands/eval/commands/__tests__/bench.test.ts
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';

const OUT_DIR = join(import.meta.dirname, '__tmp_bench_test__');

describe('eval bench', () => {
  beforeEach(async () => {
    const testDir = join(OUT_DIR, 'test-01');
    const codeResultsDir = join(testDir, 'code_grader_results');
    const llmGradersDir = join(testDir, 'llm_graders');
    const codeGradersDir = join(testDir, 'code_graders');
    await mkdir(codeResultsDir, { recursive: true });
    await mkdir(llmGradersDir, { recursive: true });
    await mkdir(codeGradersDir, { recursive: true });

    await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify({
      eval_file: 'test.eval.yaml',
      timestamp: new Date().toISOString(),
      target: { name: 'test-target', kind: 'cli' },
      test_ids: ['test-01'],
    }));
    // Code grader result
    await writeFile(join(codeResultsDir, 'contains.json'), JSON.stringify({
      name: 'contains', type: 'code-grader', score: 1.0, weight: 1.0,
      assertions: [{ text: 'Found keyword', passed: true }],
    }));
    // LLM grader metadata (for weight)
    await writeFile(join(llmGradersDir, 'relevance.json'), JSON.stringify({
      name: 'relevance', weight: 2.0, threshold: 0.5, prompt_content: '...',
    }));
    // Code grader metadata (for weight)
    await writeFile(join(codeGradersDir, 'contains.json'), JSON.stringify({
      name: 'contains', command: ['echo'], weight: 1.0,
    }));
  });

  afterEach(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it('writes grading.json with merged scores and pass_rate', async () => {
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: {
          score: 0.8,
          assertions: [{ text: 'Relevant response', passed: true, evidence: 'matches criteria' }],
        },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'bench', OUT_DIR], { input: llmScores });

    const grading = JSON.parse(await readFile(join(OUT_DIR, 'test-01', 'grading.json'), 'utf8'));
    expect(grading.summary.pass_rate).toBeGreaterThan(0);
    expect(grading.assertions.length).toBeGreaterThan(0);
    expect(grading.evaluators).toHaveLength(2); // code + llm
  });

  it('writes index.jsonl with one entry per test', async () => {
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: {
          score: 0.8,
          assertions: [{ text: 'Relevant', passed: true }],
        },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'bench', OUT_DIR], { input: llmScores });

    const indexContent = await readFile(join(OUT_DIR, 'index.jsonl'), 'utf8');
    const lines = indexContent.trim().split('\n').map(JSON.parse);
    expect(lines).toHaveLength(1);
    expect(lines[0].test_id).toBe('test-01');
    expect(lines[0].score).toBeGreaterThan(0);
  });

  it('writes benchmark.json with run_summary', async () => {
    const llmScores = JSON.stringify({
      'test-01': {
        relevance: { score: 0.8, assertions: [{ text: 'ok', passed: true }] },
      },
    });

    const { execa } = await import('execa');
    await execa('bun', ['apps/cli/src/cli.ts', 'eval', 'bench', OUT_DIR], { input: llmScores });

    const benchmark = JSON.parse(await readFile(join(OUT_DIR, 'benchmark.json'), 'utf8'));
    expect(benchmark.metadata.targets).toContain('test-target');
    expect(benchmark.run_summary['test-target']).toBeDefined();
  });
});
```

### Step 2: Run tests to verify they fail

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/bench.test.ts
```

### Step 3: Implement `eval bench` subcommand

Create `apps/cli/src/commands/eval/commands/bench.ts`:

The handler:

1. Read `manifest.json`
2. Read LLM grader scores from stdin (JSON)
3. For each test_id:
   - Read all `code_grader_results/<name>.json`
   - Read LLM scores for this test from stdin data
   - Read weight metadata from `code_graders/<name>.json` and `llm_graders/<name>.json`
   - Compute weighted average score across all evaluators
   - Build assertions array (merged from code + LLM)
   - Build evaluators array (per-evaluator breakdown)
   - Write `grading.json` using the existing `GradingArtifact` interface from `artifact-writer.ts`
4. Build index entries and write `index.jsonl` (one line per test, snake_case)
5. Build and write `benchmark.json` using `buildBenchmarkArtifact()` pattern from `artifact-writer.ts`
6. Print summary to stdout

Reuse types and patterns from `artifact-writer.ts`:
- `GradingArtifact` interface for grading.json structure
- `BenchmarkArtifact` interface for benchmark.json structure
- `computeStats()` helper for mean/stddev calculations
- `IndexArtifactEntry` type for index.jsonl entries

### Step 4: Register the subcommand

Add to `apps/cli/src/commands/eval/index.ts`:

```typescript
import { evalBenchCommand } from './commands/bench.js';

// In cmds:
bench: evalBenchCommand,
```

### Step 5: Run tests to verify they pass

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/bench.test.ts
```

### Step 6: Commit

```bash
git add apps/cli/src/commands/eval/commands/bench.ts \
  apps/cli/src/commands/eval/commands/__tests__/bench.test.ts \
  apps/cli/src/commands/eval/index.ts
git commit -m "feat(cli): add eval bench subcommand for score aggregation and benchmarking"
git push
```

---

## Task 4: Python wrapper scripts

**Files:**
- Create: `plugins/agentv-dev/skills/agentv-bench/scripts/run_tests.py`
- Create: `plugins/agentv-dev/skills/agentv-bench/scripts/run_code_graders.py`
- Create: `plugins/agentv-dev/skills/agentv-bench/scripts/bench.py`

### Step 1: Create `run_tests.py`

```python
#!/usr/bin/env python3
"""
Run eval test cases by extracting inputs and invoking CLI targets.

Calls `agentv eval input` to extract inputs, then invokes each test's CLI
target command in parallel, writing response.md per test.

Usage:
    python run_tests.py <eval-path> --out <dir> [--workers N]

Example:
    python run_tests.py evals/repro.eval.yaml --out .agentv/results/export/run-1

Output structure:
    <out-dir>/
    ├── manifest.json          ← from agentv eval input
    ├── <test-id>/
    │   ├── input.json         ← from agentv eval input
    │   ├── invoke.json        ← from agentv eval input
    │   ├── response.md        ← target output (written by this script)
    │   └── timing.json        ← execution timing (written by this script)

For agent-as-target mode (invoke.json has kind=agent), this script only runs
`agentv eval input`. The agent handles execution directly.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def run_agentv_input(eval_path: str, out_dir: str) -> dict:
    """Call agentv eval input and return the manifest."""
    result = subprocess.run(
        ["agentv", "eval", "input", eval_path, "--out", out_dir],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"agentv eval input failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    manifest_path = Path(out_dir) / "manifest.json"
    return json.loads(manifest_path.read_text())


def invoke_cli_target(test_dir: Path) -> None:
    """Read invoke.json and execute the CLI target command."""
    invoke_path = test_dir / "invoke.json"
    invoke = json.loads(invoke_path.read_text())

    if invoke.get("kind") != "cli":
        return  # Agent-as-target — skip CLI invocation

    input_data = json.loads((test_dir / "input.json").read_text())
    command_template = invoke["command"]
    cwd = invoke.get("cwd")
    timeout_s = invoke.get("timeout_ms", 30000) / 1000

    # Write prompt to temp file for {PROMPT_FILE} placeholder
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as pf:
        pf.write(input_data["input_text"])
        prompt_file = pf.name

    # Create output file path for {OUTPUT_FILE} placeholder
    output_file = tempfile.mktemp(suffix=".txt")

    # Render template
    rendered = command_template
    rendered = rendered.replace("{PROMPT}", input_data["input_text"])
    rendered = rendered.replace("{PROMPT_FILE}", prompt_file)
    rendered = rendered.replace("{OUTPUT_FILE}", output_file)

    start = time.time()
    try:
        result = subprocess.run(
            rendered, shell=True, cwd=cwd,
            capture_output=True, text=True, timeout=timeout_s,
        )
        duration_ms = int((time.time() - start) * 1000)

        if result.returncode != 0:
            response = f"ERROR: target exited with code {result.returncode}\n{result.stderr}"
        elif os.path.exists(output_file):
            response = Path(output_file).read_text()
        else:
            response = result.stdout
    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - start) * 1000)
        response = f"ERROR: target timed out after {timeout_s}s"
    finally:
        for f in [prompt_file, output_file]:
            try:
                os.unlink(f)
            except OSError:
                pass

    (test_dir / "response.md").write_text(response)
    (test_dir / "timing.json").write_text(json.dumps({
        "duration_ms": duration_ms,
        "total_duration_seconds": round(duration_ms / 1000, 3),
    }, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Run eval test cases")
    parser.add_argument("eval_path", help="Path to eval YAML file")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--workers", type=int, default=3, help="Parallel workers (default: 3)")
    args = parser.parse_args()

    manifest = run_agentv_input(args.eval_path, args.out)
    out = Path(args.out)

    test_ids = manifest["test_ids"]
    cli_tests = []
    for tid in test_ids:
        test_dir = out / tid
        invoke = json.loads((test_dir / "invoke.json").read_text())
        if invoke.get("kind") == "cli":
            cli_tests.append(test_dir)

    if not cli_tests:
        print(f"Extracted {len(test_ids)} test(s). No CLI targets to invoke (agent-as-target mode).")
        return

    print(f"Running {len(cli_tests)} CLI target(s) with {args.workers} workers...")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(invoke_cli_target, td): td.name for td in cli_tests}
        for future in as_completed(futures):
            tid = futures[future]
            try:
                future.result()
                print(f"  {tid}: done")
            except Exception as e:
                print(f"  {tid}: ERROR — {e}", file=sys.stderr)

    print(f"Done. Responses written to {args.out}")


if __name__ == "__main__":
    main()
```

### Step 2: Create `run_code_graders.py`

```python
#!/usr/bin/env python3
"""
Run code-grader assertions on existing responses.

Calls `agentv eval grade` to execute all code-grader assertions declared in
the eval against response.md files in the export directory.

Usage:
    python run_code_graders.py <export-dir>

Example:
    python run_code_graders.py .agentv/results/export/run-1

Prerequisites:
    - `agentv eval input` has been run (or run_tests.py)
    - response.md exists in each test directory

Output:
    <export-dir>/<test-id>/code_grader_results/<name>.json
"""
import argparse
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Run code-grader assertions")
    parser.add_argument("export_dir", help="Export directory from eval input")
    args = parser.parse_args()

    result = subprocess.run(
        ["agentv", "eval", "grade", args.export_dir],
        capture_output=False,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
```

### Step 3: Create `bench.py`

```python
#!/usr/bin/env python3
"""
Merge evaluator scores and produce final benchmark artifacts.

Calls `agentv eval bench` to merge code-grader results with LLM grader
scores, compute weighted pass_rate, and write grading.json + index.jsonl +
benchmark.json.

Usage:
    python bench.py <export-dir> < llm_scores.json
    echo '{"test-01": {"relevance": {"score": 0.8, ...}}}' | python bench.py <export-dir>

Example:
    python bench.py .agentv/results/export/run-1 < llm_scores.json

Stdin format (LLM grader scores):
    {
      "<test-id>": {
        "<grader-name>": {
          "score": 0.85,
          "assertions": [{"text": "...", "passed": true, "evidence": "..."}]
        }
      }
    }

Output:
    <export-dir>/index.jsonl       ← per-test manifest
    <export-dir>/benchmark.json    ← aggregate statistics
    <export-dir>/<test-id>/grading.json ← merged grading per test
"""
import argparse
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description="Merge scores and produce benchmark artifacts")
    parser.add_argument("export_dir", help="Export directory")
    args = parser.parse_args()

    # Pass stdin through to agentv eval bench
    result = subprocess.run(
        ["agentv", "eval", "bench", args.export_dir],
        stdin=sys.stdin,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
```

### Step 4: Commit

```bash
git add plugins/agentv-dev/skills/agentv-bench/scripts/run_tests.py \
  plugins/agentv-dev/skills/agentv-bench/scripts/run_code_graders.py \
  plugins/agentv-dev/skills/agentv-bench/scripts/bench.py
git commit -m "feat(agentv-bench): add Python wrapper scripts for agent-mode eval pipeline"
git push
```

---

## Task 5: Update SKILL.md

**Files:**
- Modify: `plugins/agentv-dev/skills/agentv-bench/SKILL.md`

### Step 1: Update the "Bundled scripts layer" section

Replace the existing scripts list with the new scripts:

```markdown
## Bundled scripts layer

This skill ships with a Python scripts layer in `plugins/agentv-dev/skills/agentv-bench/scripts/`. Requires Python 3.11+ and the `agentv` CLI installed. No extra dependencies — all scripts use the stdlib only.

### Eval pipeline scripts (agent mode)

These scripts break the eval pipeline into discrete steps. The agent runs them in order, only handling LLM grading directly:

- `scripts/run_tests.py <eval-path> --out <dir>` — Extract inputs and invoke CLI targets in parallel. Writes `response.md` per test. For agent-as-target, only extracts inputs (agent handles execution).
- `scripts/run_code_graders.py <dir>` — Run code-grader assertions on existing responses. Writes per-grader results.
- `scripts/bench.py <dir> < llm_scores.json` — Merge code-grader + LLM scores, compute weighted pass_rate, write `grading.json` + `index.jsonl` + `benchmark.json`.

### Agent-mode workflow

```bash
# 1. Extract inputs and run CLI targets
python scripts/run_tests.py evals/repro.eval.yaml --out .agentv/results/export/run-1

# 2. Run code graders (deterministic, no LLM needed)
python scripts/run_code_graders.py .agentv/results/export/run-1

# 3. Agent performs LLM grading (reads llm_graders/*.json, produces scores JSON)
# ... agent reads prompts, grades responses, writes llm_scores.json ...

# 4. Merge all scores and produce final artifacts
python scripts/bench.py .agentv/results/export/run-1 < llm_scores.json
```
```

### Step 2: Update the "Agent mode: Running eval.yaml without CLI" section

Replace the 5-step manual process with the scripts-based workflow. Update the section to reference the new scripts and remove the manual YAML parsing / subagent spawning / results assembly instructions.

### Step 3: Fix the code-grader example

The issue's code-grader example uses raw stdin readline. Update any inline examples to use `defineCodeGrader`:

```typescript
// graders/contains.ts
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ outputText }) => {
  const found = outputText.includes('hello');
  return {
    score: found ? 1 : 0,
    assertions: [{
      text: found ? 'Found hello' : 'Missing hello',
      passed: found,
    }],
  };
});
```

### Step 4: Commit

```bash
git add plugins/agentv-dev/skills/agentv-bench/SKILL.md
git commit -m "docs(agentv-bench): update SKILL.md with agent-mode eval pipeline scripts"
git push
```

---

## Task 6: Update eval-yaml-spec.md reference

**Files:**
- Modify: `plugins/agentv-dev/skills/agentv-bench/references/eval-yaml-spec.md`

### Step 1: Add a section for the agent-mode pipeline CLI commands

Add a new section documenting the `eval input`, `eval grade`, and `eval bench` subcommands and their data contracts. This ensures the grader agent has the reference it needs.

### Step 2: Fix the code-grader recipe

Update the `code-grader` section to reference `defineCodeGrader` from `@agentv/eval` as the canonical way to write code graders.

### Step 3: Commit

```bash
git add plugins/agentv-dev/skills/agentv-bench/references/eval-yaml-spec.md
git commit -m "docs(agentv-bench): add agent-mode pipeline commands to eval-yaml-spec reference"
git push
```

---

## Task 7: Integration test — end-to-end pipeline

**Files:**
- Create: `apps/cli/src/commands/eval/commands/__tests__/pipeline-e2e.test.ts`
- Create: `apps/cli/src/commands/eval/commands/__fixtures__/e2e/` (fixtures)

### Step 1: Create test fixture

Create a minimal eval with a CLI target (echo), a code-grader (always-pass echo), and an llm-grader config:

```yaml
# __fixtures__/e2e/pipeline.eval.yaml
name: pipeline-e2e
tests:
  - id: test-01
    input: hello world
    criteria: Response echoes the input
    assertions:
      - name: echo_check
        type: code-grader
        command: bash -c 'echo ''{"score":1,"assertions":[{"text":"pass","passed":true}]}'''
        weight: 1.0
      - name: relevance
        type: llm-grader
        prompt: Is the response relevant to the input?
        weight: 1.0
```

### Step 2: Write the e2e test

The test runs the full pipeline:
1. `agentv eval input` → verify manifest + per-test dirs
2. Write a mock `response.md` (simulating target execution)
3. `agentv eval grade` → verify code_grader_results written
4. `agentv eval bench` with mock LLM scores on stdin → verify grading.json + index.jsonl + benchmark.json

### Step 3: Run the test

```bash
bun test apps/cli/src/commands/eval/commands/__tests__/pipeline-e2e.test.ts
```

### Step 4: Commit

```bash
git add apps/cli/src/commands/eval/commands/__tests__/pipeline-e2e.test.ts \
  apps/cli/src/commands/eval/commands/__fixtures__/e2e/
git commit -m "test(cli): add end-to-end integration test for agent-mode eval pipeline"
git push
```

---

## Task 8: Run full test suite and verify

### Step 1: Run all tests

```bash
bun run test
```

### Step 2: Run typecheck

```bash
bun run typecheck
```

### Step 3: Run lint

```bash
bun run lint
```

### Step 4: Manual red/green UAT

**Red (before):** Run `agentv eval input` — command not found (on main branch).

**Green (after):** Run the full pipeline:
```bash
bun apps/cli/src/cli.ts eval input examples/features/sdk-custom-assertion/evals/dataset.eval.yaml --out /tmp/agentv-test-export
cat /tmp/agentv-test-export/manifest.json
ls /tmp/agentv-test-export/*/
```

Verify manifest.json and per-test directories are written correctly.

### Step 5: Commit any fixes

```bash
git commit -m "fix(cli): address test/lint issues in agent-mode eval pipeline"
git push
```

---

## Dependency Graph

```
Task 1 (eval input) ──┐
                       ├── Task 4 (Python scripts) ── Task 5 (SKILL.md) ── Task 6 (eval-yaml-spec)
Task 2 (eval grade) ──┤
                       │
Task 3 (eval bench) ──┘
                       └── Task 7 (e2e test) ── Task 8 (full verification)
```

Tasks 1-3 can be implemented in parallel (they share the export dir format but are independent CLI commands). Task 4 depends on all three. Tasks 5-6 can be done after Task 4. Task 7 depends on Tasks 1-3. Task 8 is the final verification.
