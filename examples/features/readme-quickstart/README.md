# README Quickstart

This example mirrors the root README quickstart and is used for smoke testing the documented `llm-rubric` and `default_test.options.rubric_prompt` flow.

Run it against a local OpenAI-compatible endpoint:

```bash
LOCAL_OPENAI_PROXY_BASE_URL=http://127.0.0.1:10531/v1 \
LOCAL_OPENAI_PROXY_API_KEY=dummy-local-key \
LOCAL_OPENAI_PROXY_MODEL=gpt-5.3-codex-spark \
bun apps/cli/src/cli.ts eval examples/features/readme-quickstart/evals/my-eval.eval.yaml \
  --targets examples/features/readme-quickstart/targets.yaml
```
