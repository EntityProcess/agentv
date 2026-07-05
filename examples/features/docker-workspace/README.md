# Docker Workspace Example

This example demonstrates how to run script-grader evaluations inside Docker containers.

## Use Case

When evaluating coding agents (e.g., SWE-bench), the grader script needs to:
1. Apply the agent's patch to a repository
2. Run tests inside the repository's environment
3. Report pass/fail results

Docker environments let you run this grading process inside a pre-built container
image that has the repository, dependencies, and test infrastructure ready.

## How It Works

```
1. AgentV sends prompt to agent target → receives patch/diff output
2. docker pull <image> (once per eval run, cached)
3. For each test case:
   a. docker create --memory=4g --cpus=2 <image>
   b. docker start <container>
   c. docker exec -i <container> <grader-command> < payload.json
   d. Parse grader JSON output (score, assertions)
   e. docker rm -f <container>
4. Aggregate results
```

## YAML Schema

```yaml
environment:
  type: docker
  image: swebench/sweb.eval.x86_64.django__django-15180
  workdir: /testbed
  resources:
    memory: 4g       # optional Docker memory limit
    cpus: 2          # optional Docker CPU limit
```

For evals that need a repo pinned to a dataset snapshot, keep that metadata in `environment.setup.args`:

```yaml
environment:
  type: docker
  image: swebench/sweb.eval.x86_64.django__django-15180
  workdir: /testbed
  setup:
    command: ./setup.sh
    args:
      commit: abc123def
```

Prebuilt images can carry the repository inside the container, while the setup args record the dataset snapshot being evaluated.

## Running

```bash
# Requires Docker to be installed and running
bun apps/cli/src/cli.ts eval examples/features/docker-workspace/evals/docker-example.EVAL.yaml
```
