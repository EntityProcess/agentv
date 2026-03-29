# AgentV

**Evaluate AI agents from the terminal. No server. No signup.**

```bash
npm install -g agentv
agentv init
agentv eval evals/example.yaml
```

That's it. Results in seconds, not minutes.

## What it does

AgentV runs evaluation cases against your AI agents and scores them with deterministic code graders + customizable LLM graders. Everything lives in Git — YAML eval files, markdown judge prompts, JSONL results.

```yaml
# evals/math.yaml
description: Math problem solving
tests:
  - id: addition
    input: What is 15 + 27?
    expected_output: "42"
    assertions:
      - type: contains
        value: "42"
```

```bash
agentv eval evals/math.yaml
```

## Why AgentV?

- **Local-first** — runs on your machine, no cloud accounts or API keys for eval infrastructure
- **Version-controlled** — evals, judges, and results all live in Git
- **Hybrid graders** — deterministic code checks + LLM-based subjective scoring
- **CI/CD native** — exit codes, JSONL output, threshold flags for pipeline gating
- **Any agent** — supports Claude, Codex, Copilot, VS Code, Pi, Azure OpenAI, or any CLI agent

## Quick start

**1. Install and initialize:**
```bash
npm install -g agentv
agentv init
```

**2. Configure targets** in `.agentv/targets.yaml` — point to your agent or LLM provider.

**3. Create an eval** in `evals/`:
```yaml
description: Code generation quality
tests:
  - id: fizzbuzz
    criteria: Write a correct FizzBuzz implementation
    input: Write FizzBuzz in Python
    assertions:
      - type: contains
        value: "fizz"
      - type: code-grader
        command: ./validators/check_syntax.py
      - type: llm-grader
        prompt: ./graders/correctness.md
```

**4. Run it:**
```bash
agentv eval evals/my-eval.yaml
```

**5. Compare results across targets:**
```bash
agentv compare .agentv/results/runs/eval_<timestamp>/index.jsonl
```

## Output formats

```bash
agentv eval evals/my-eval.yaml                  # JSONL (default)
agentv eval evals/my-eval.yaml -o report.html   # HTML dashboard
agentv eval evals/my-eval.yaml -o results.xml   # JUnit XML for CI
```

## TypeScript SDK

Use AgentV programmatically:

```typescript
import { evaluate } from '@agentv/core';

const { results, summary } = await evaluate({
  tests: [
    {
      id: 'greeting',
      input: 'Say hello',
      assertions: [{ type: 'contains', value: 'Hello' }],
    },
  ],
});

console.log(`${summary.passed}/${summary.total} passed`);
```

## Documentation

Full docs at [agentv.dev/docs](https://agentv.dev/docs/getting-started/introduction/).

- [Eval files](https://agentv.dev/docs/evaluation/eval-files/) — format and structure
- [Custom evaluators](https://agentv.dev/docs/evaluators/custom-evaluators/) — code graders in any language
- [Rubrics](https://agentv.dev/docs/evaluation/rubrics/) — structured criteria scoring
- [Targets](https://agentv.dev/docs/targets/configuration/) — configure agents and providers
- [Compare results](https://agentv.dev/docs/tools/compare/) — A/B testing and regression detection
- [Comparison with other frameworks](https://agentv.dev/docs/reference/comparison/) — vs Braintrust, Langfuse, LangSmith, LangWatch

## Development

```bash
git clone https://github.com/EntityProcess/agentv.git
cd agentv
bun install && bun run build
bun test
```

See [AGENTS.md](AGENTS.md) for development guidelines.

## License

MIT
