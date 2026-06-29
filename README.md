# AgentV

**Evaluate AI agents against real repos from the terminal. No server. No signup.**

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
- **Repo-backed workspaces** — reuse real repos, setup scripts, and existing harnesses instead of rebuilding synthetic tasks
- **Portable artifacts** — results, traces, and reports are saved in a durable format other tools can consume
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
agentv compare .agentv/results/default/<timestamp>/index.jsonl
```

## Output formats

```bash
agentv eval evals/my-eval.yaml --output ./run   # writes ./run/index.jsonl
cat ./run/index.jsonl                         # JSONL results for scripts/CI
```

## TypeScript SDK

Use AgentV programmatically:

```typescript
import { evaluate } from '@agentv/sdk';

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
- [Custom graders](https://agentv.dev/docs/graders/custom-graders/) — code graders in any language
- [Rubrics](https://agentv.dev/docs/evaluation/rubrics/) — structured criteria scoring
- [Targets](https://agentv.dev/docs/targets/configuration/) — configure agents and providers
- [Compare results](https://agentv.dev/docs/tools/compare/) — A/B testing and regression detection
- [Ecosystem](https://agentv.dev/docs/reference/comparison/) — how AgentV fits with Agent Control and Langfuse

## Development

```bash
git clone https://github.com/EntityProcess/agentv.git
cd agentv
bun install && bun run build
bun test
```

See [AGENTS.md](AGENTS.md) for development guidelines.

## Docker Dashboard Deployment

To simulate a one-command production deployment of AgentV Dashboard with the
AgentV examples project and a remote results repository:

```bash
AGENTV_RESULTS_REPO=EntityProcess/agentv-evalresults \
  scripts/setup-dashboard-deployment.sh
```

The script clones AgentV examples into `~/agentv-dashboard`, clones the results
repo, writes the Dashboard project registry under the `$AGENTV_HOME` config
pair, builds the Docker image, and starts Dashboard at `http://localhost:3117`.

## License

MIT
