# Bug Fix Benchmark

**SWE-bench style evaluation**: Real-world bug fixing on public GitHub repositories.

This showcase demonstrates AgentV's ability to:
1. Clone public repositories at specific commits
2. Evaluate coding agents on real bug fixes
3. Run tests in isolated Docker containers
4. Grade against passing/failing test cases

## Use Case

Benchmark coding agents on their ability to:
- Diagnose bugs from issue descriptions
- Navigate unfamiliar codebases
- Write correct fixes
- Ensure tests pass (without breaking existing tests)

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Clone public repo (e.g., sympy/sympy)                         │
│ 2. Checkout base_commit (broken state)                          │
│ 3. Agent receives issue description + test failure             │
│ 4. Agent diagnoses and writes fix                               │
│ 5. Run test suite in Docker                                     │
│ 6. Grade: FAIL_TO_PASS → pass? PASS_TO_PASS → still pass?      │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option 1: Mock Agent (Fastest)

```bash
# Uses a mock agent - no API keys needed
bun run agentv eval evals/bug-fixes.eval.yaml --target mock_agent
```

### Option 2: Claude Code (Subscription)

```bash
# Uses your Claude Code subscription (Claude Pro/Max)
# No API key needed - runs with your auth
bun run agentv eval evals/bug-fixes.eval.yaml --target claude_subscription
```

### Option 3: Claude API (API Key)

```bash
# Requires ANTHROPIC_API_KEY in .env
bun run agentv eval evals/bug-fixes.eval.yaml --target claude_api
```

## Configuration

### Target Setup

Create `.agentv/targets.yaml`:

```yaml
targets:
  # Mock agent - no auth, fast for testing
  - name: mock_agent
    provider: cli
    command: bash scripts/mock-agent.sh {PROMPT_FILE} {OUTPUT_FILE}
    grader_target: mock_grader

  # Claude Code - uses your Claude subscription
  # IMPORTANT: Remove ANTHROPIC_API_KEY from .env to use subscription auth
  - name: claude_subscription
    provider: claude
    grader_target: azure-base

  # Claude API - requires ANTHROPIC_API_KEY
  - name: claude_api
    provider: anthropic
    api_key: ${{ ANTHROPIC_API_KEY }}
    model: claude-sonnet-4-20250514
    grader_target: azure-base

  # Grader target for LLM-based evaluation
  - name: azure-base
    provider: azure
    endpoint: ${{ AZURE_OPENAI_ENDPOINT }}
    api_key: ${{ AZURE_OPENAI_API_KEY }}
    model: ${{ AZURE_DEPLOYMENT_NAME }}
```

### Environment Variables

```bash
# For subscription-based auth (Claude Code)
# Nothing needed! Just ensure Claude Code is installed.

# For API-based auth
ANTHROPIC_API_KEY=sk-ant-...
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_API_KEY=...
AZURE_DEPLOYMENT_NAME=gpt-4o
```

## Auth Options Summary

| Target | Auth Method | API Key Required | Speed |
|--------|-------------|------------------|-------|
| `mock_agent` | None | ❌ No | Fastest |
| `claude_subscription` | Claude subscription | ❌ No | Fast |
| `claude_api` | Anthropic API | ✅ Yes | Medium |
| `copilot` | GitHub Copilot | ❌ No* | Fast |
| `vscode` | VS Code + Copilot | ❌ No* | Slow |

*Requires GitHub Copilot subscription, not an API key.

## Example Test Cases

Each test case follows SWE-bench format:

```yaml
tests:
  - case: sympy-18154-null-check
    metadata:
      repo: sympy/sympy
      base_commit: "9aabb2376ea5ac18bb17310f88481a450398b74f"
      problem_statement: |
        Bug: Matrix.nullspace() crashes when matrix contains None values

        When calling nullspace() on a matrix with None elements, it throws
        TypeError instead of handling None gracefully.

        Expected: Return empty nullspace or handle None
        Actual: TypeError: Cannot read property 'toString' of null
    input: |
      Fix the bug in sympy/matrices/matrices.py
      Run tests to verify the fix.
    assertions:
      - type: code-grader
        command: |
          docker exec -i testbed pytest sympy/matrices/tests/test_matrices.py -v
```

## Workspace Setup

AgentV automatically:
1. Clones the repo at `base_commit`
2. Sets up Docker container (if using `workspace.docker`)
3. Mounts workspace into container
4. Runs tests in isolation

## Adding New Test Cases

1. Find a bug fix from GitHub issues/PRs
2. Note the `base_commit` (before the fix)
3. Copy the issue description as `problem_statement`
4. Identify failing tests that should pass after fix
5. Add to `evals/bug-fixes.eval.yaml`

```yaml
tests:
  - case: my-bug-fix
    metadata:
      repo: owner/repo
      base_commit: "abc123..."
      problem_statement: |
        Copy from GitHub issue...
    input: "Fix the bug described in the metadata."
```

## SWE-bench Compatibility

This example is compatible with SWE-bench dataset format:

```json
{
  "repo": "sympy/sympy",
  "instance_id": "sympy__sympy-18154",
  "base_commit": "9aabb2376ea5ac18bb17310f88481a450398b74f",
  "problem_statement": "<GitHub issue text>",
  "FAIL_TO_PASS": ["test_module::test_case_1"],
  "PASS_TO_PASS": ["test_module::test_case_2"]
}
```

Use the provided script to import SWE-bench instances:

```bash
./scripts/import-swebench.sh
```

## Running Subsets

```bash
# Run single test case
bun run agentv eval evals/bug-fixes.eval.yaml --filter "sympy-18154"

# Run only Python repos
bun run agentv eval evals/bug-fixes.eval.yaml --filter "sympy|django|flask"

# Run with timeout
bun run agentv eval evals/bug-fixes.eval.yaml --timeout 900
```

## Results

Results are saved to `.agentv/results/`:

```bash
# View results
cat .agentv/results/runs/<timestamp>/index.jsonl

# Generate HTML report
bun run agentv eval evals/bug-fixes.eval.yaml -o report.html

# Compare runs
bun run agentv compare .agentv/results/runs/<timestamp1>/index.jsonl \
                      .agentv/results/runs/<timestamp2>/index.jsonl
```

## Limitations

- **Network required**: Public repos must be accessible via `git clone`
- **Large repos**: Initial clone can be slow (use `clone.depth: 1` for shallow clones)
- **Flaky tests**: Some tests may be non-deterministic
- **External state**: Repo could change or be deleted

## See Also

- [SWE-bench](https://www.swebench.com/) — Original benchmark
- [workspace-multi-repo](../../features/workspace-multi-repo/) — Multi-repo workspace examples
- [docker-workspace](../../features/docker-workspace/) — Docker workspace examples
- [cross-repo-sync](../cross-repo-sync/) — Code agent showcase
