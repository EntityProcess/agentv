# README Quickstart

This example mirrors the root README quickstart and is used for smoke testing the documented `llm-rubric` and `default_test.options.rubric_prompt` flow.

It includes a composable `.agentv/config.yaml` that decomposes the base config
graph into direct field refs:

```yaml
targets: file://targets.yaml
tests: file://tests.yaml
defaults: file://defaults.yaml
```

Each referenced file contains that field's value directly, such as a bare target
array in `.agentv/targets.yaml` and a bare defaults object in
`.agentv/defaults.yaml`. A grader is not a separate kind of entity — it is a
target listed under `targets` like any other, selected for the grading role
via `defaults.grader`.

Run it against a local OpenAI-compatible endpoint:

```bash
LOCAL_OPENAI_PROXY_BASE_URL=http://127.0.0.1:10531/v1 \
LOCAL_OPENAI_PROXY_API_KEY=dummy-local-key \
LOCAL_OPENAI_PROXY_MODEL=gpt-5.3-codex-spark \
bun apps/cli/src/cli.ts eval examples/features/readme-quickstart/evals/my-eval.eval.yaml
```
