# AgentV

Test AI providers on real repo tasks and measure what actually works.

## Why?

- **Local-first** — runs on your machine, no cloud accounts or API keys for eval infrastructure
- **Repo-backed environments** — reuse real repos, setup scripts, Docker images, and existing harnesses instead of rebuilding synthetic tasks
- **Portable artifacts** — results, traces, and reports are saved in a durable format other tools can consume
- **Version-controlled** — evals, judges, and results all live in Git
- **Hybrid graders** — deterministic code checks + LLM-based subjective scoring
- **CI/CD native** — exit codes, JSONL output, threshold flags for pipeline gating
- **Any provider** — run against agents, model providers, gateways, replay providers, CLI wrappers, transcript providers, and future app or service wrappers

## Core Concepts

- **Eval suite / tests** are the task corpus: the prompts, cases, datasets, and reusable field-local files you want to evaluate.
- **Category** is derived from where the eval lives, such as folder path and file name. Use paths to organize the corpus instead of repeating category labels in every eval.
- **Environment / fixtures / graders** are task-owned context: host or Docker setup, repos, setup scripts, files, fixtures, deterministic checks, and LLM grading prompts.
- **Provider** is the configured system under test: an agent, model provider, gateway, replay provider, CLI wrapper, transcript provider, or future app/service wrapper. Each provider entry uses `id` for the backend/spec and optional `label` for the stable AgentV selection and result identity.
- **Tags** are run/result grouping labels. `tags.experiment` is the default experiment namespace, such as `with-skills` or `without-skills`; keep suite/category and provider/model names out of that tag.
- **Evaluate options** configure eval run behavior such as `max_concurrency`, repeat sample count, and budgets.
- **Default test** configures inherited per-test defaults such as score `threshold`.
- **Run** is one concrete execution of a tagged eval against a resolved provider that writes portable artifacts for readers such as Dashboard, compare, and trend.

## Quick start

**1. Install and initialize:**
```bash
npm install -g agentv
agentv init
```

**2. Configure providers and graders** in `.agentv/providers.yaml` — point to the system under test and the reusable grader. Provider `id` names the backend/spec; `label` is the stable selection name used by evals and CLI flags:

```yaml
providers:
  - id: openai
    label: local-openai
    runtime: host
    config:
      api_format: chat
      base_url: "{{ env.LOCAL_OPENAI_PROXY_BASE_URL }}"
      api_key: "{{ env.LOCAL_OPENAI_PROXY_API_KEY }}"
      model: "{{ env.LOCAL_OPENAI_PROXY_MODEL }}"

  - id: openai
    label: local-openai-grader
    runtime: host
    config:
      api_format: chat
      base_url: "{{ env.LOCAL_OPENAI_PROXY_BASE_URL }}"
      api_key: "{{ env.LOCAL_OPENAI_PROXY_API_KEY }}"
      model: "{{ env.LOCAL_OPENAI_PROXY_MODEL }}"

defaults:
  provider: local-openai
  grader: local-openai-grader
```

**3. Create shared test defaults** in `evals/default-test.yaml`. This is a partial test config that AgentV applies to each test:

```yaml
threshold: 0.8
options:
  rubric_prompt: |
    You are an expert grader. Evaluate the candidate answer against each rubric item.
    Award credit only when the answer directly supports the criterion.

    [[ ## question ## ]]
    {{ input }}

    [[ ## rubric ## ]]
    {{ rubrics }}

    [[ ## answer ## ]]
    {{ output }}
```

**4. Create an eval** in `evals/my-eval.eval.yaml`:
```yaml
description: Code generation quality
tags:
  experiment: with-skills
providers:
  - local-openai
evaluate_options:
  max_concurrency: 2

default_test: file://./default-test.yaml

prompts:
  - "{{ input }}"

tests:
  - id: fizzbuzz
    vars:
      input: Write FizzBuzz in Python. Use lowercase output strings "fizz", "buzz", and "fizzbuzz". Return only one Python code block.
    assert:
      - type: contains
        value: "fizz"
      - Implements correct FizzBuzz logic for multiples of 3, 5, and 15
      - type: script
        command: ["python3", "../validators/check_syntax.py"]
      - type: llm-rubric
        value:
          - outcome: Solution is simple and idiomatic Python
            weight: 0.5
          - outcome: Handles the 3, 5, and 15 branches correctly
            weight: 1.5
```

Plain assertion strings are short-form rubric criteria: AgentV groups them into
`llm-rubric` and writes grader detail to `grading.json.component_results` for
the Dashboard. Use explicit `type: llm-rubric` when you need weights, required
flags, `score_ranges`, a custom grader prompt, a grader provider, or output
transforms; use string `value` for free-form rubric checks. Executable graders
use `type: script`.

The provider can be an eval-local object when this eval needs provider settings of its own:

```yaml
description: Code generation quality with eval-local provider settings
tags:
  experiment: with-skills
providers:
  - id: openai
    label: local-mini
    runtime: host
    config:
      api_format: chat
      base_url: "{{ env.LOCAL_OPENAI_PROXY_BASE_URL }}"
      api_key: "{{ env.LOCAL_OPENAI_PROXY_API_KEY }}"
      model: gpt-5.4-mini
evaluate_options:
  repeat: 2

default_test:
  threshold: 0.85

prompts:
  - "{{ input }}"

tests:
  - id: fizzbuzz
    vars:
      input: Write FizzBuzz in Python
```

`providers: [local-openai]` resolves the configured provider label from `.agentv/providers.yaml` and uses its backend, model, hooks, and provider settings. The object form above defines a full eval-local provider and must include enough provider configuration to run. AgentV records the resolved provider information in run artifacts so results can be audited and replayed. The `tags.experiment` label stays `with-skills` because the condition is unchanged; the model/provider variation belongs to the resolved provider metadata.

Use `default_test.threshold` for the inherited per-test pass cutoff. `default_test` can also point at a shared file:

```yaml
default_test: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml
```

AgentV makes `AGENTV_REPO_ROOT` available during eval/config interpolation. Projects that prefer a short name can define their own reference in `.agentv/config.yaml`; `global-default` below is just an example key:

```yaml
refs:
  global-default: file://{{ env.AGENTV_REPO_ROOT }}/.agentv/default-test.yaml
```

Then eval files in that project can use `default_test: ref://global-default`.

The checked-in version of this quickstart lives in [`examples/features/readme-quickstart/`](examples/features/readme-quickstart/).

**5. Run it:**
```bash
agentv eval evals/my-eval.eval.yaml
```

**6. Compare two runs** (pass two run indexes — e.g. before and after a change):
```bash
agentv results compare .agentv/results/<baseline-run-id>/.internal/index.jsonl .agentv/results/<candidate-run-id>/.internal/index.jsonl
```

## Results

Each run writes a portable bundle directly under `.agentv/results/<run_id>/`. In this example, `tags.experiment: with-skills` names the condition being measured and `providers: [local-openai]` selects the system under test from `.agentv/providers.yaml`; both are recorded as metadata, not path segments. The `.internal/index.jsonl` file is the portable row index used by scripts, CI, and `agentv results compare`; per-case sidecars include the resolved eval and provider configuration used for the run.

```bash
agentv eval evals/my-eval.eval.yaml
cat .agentv/results/<run_id>/.internal/index.jsonl
```

Run bundle layout:

```
.agentv/results/
├── 2026-06-30T08-30-00-000Z/     # <run_id> — one committed run bundle
│   ├── summary.json              # run rollup: metadata, pass rate, counts, cost
│   ├── fizzbuzz--a1b2c3d4/       # <result_dir> for one test/provider row
│   │   ├── summary.json          # optional per-case rollup across samples
│   │   ├── test/                 # generated test bundle: frozen inputs for reproducibility
│   │   │   ├── EVAL.yaml         #   resolved eval spec
│   │   │   ├── providers.yaml    #   resolved provider config
│   │   │   └── graders/          #   grader files used
│   │   └── sample-1/             # one materialized sample
│   │       ├── result.json       # compact sample manifest
│   │       ├── grading.json      # pass, score, reason, component_results
│   │       ├── metrics.json      # tool calls, transcript stats, behavior metrics
│   │       ├── transcript.json        # normalized agent transcript
│   │       ├── transcript-raw.jsonl   # raw agent output (debugging)
│   │       └── outputs/          # captured stdout and grader outputs
│   └── .internal/
│       └── index.jsonl           # row index for scripts/CI and `agentv results compare`
├── .indexes/                     # reserved local/rebuildable indexes
└── .cache/                       # reserved local cache
```

## TypeScript SDK

Use `evaluate()` when your application owns the run:

```typescript
import { evaluate } from '@agentv/sdk';

const { results, summary } = await evaluate({
  experiment: 'with-skills',
  task: async (input) => runMyAppTarget(input),
  threshold: 0.8,
  prompts: ['{{ input }}'],
  tests: [
    {
      id: 'fizzbuzz',
      vars: { input: 'Write FizzBuzz in Python' },
      assert: [
        { type: 'contains', value: 'fizz' },
        'Implements correct FizzBuzz logic for multiples of 3, 5, and 15',
        { type: 'script', command: ['python3', './validators/check_syntax.py'] },
        { type: 'llm-rubric', value: ['Solution is simple and idiomatic Python'] },
      ],
    },
  ],
});

console.log(`${summary.passed}/${summary.total} passed`);
```

Use `*.eval.ts` when you want AgentV to run a TypeScript eval config:

```typescript
import type { EvalConfig } from '@agentv/sdk';

const config: EvalConfig = {
  description: 'Code generation quality',
  tags: { experiment: 'with-skills' },
  target: {
    extends: 'copilot-sdk',
    model: 'claude-sonnet-4.6',
  },
  repeat: 3,
  threshold: 0.8,
  prompts: ['{{ input }}'],
  environment: {
    type: 'host',
    workdir: './fixture',
    setup: {
      command: [
        'bash',
        './scripts/materialize-repo.sh',
        './fixture',
        'EntityProcess/agentv-contract-fixture',
        '21a34daed7ebcfe36cbed053607622a55e5e94cb',
      ],
      cwd: '.',
    },
  },
  tests: [
    {
      id: 'fizzbuzz',
      vars: { input: 'Write FizzBuzz in Python' },
      assert: [
        { type: 'contains', value: 'fizz' },
        'Implements correct FizzBuzz logic for multiples of 3, 5, and 15',
        { type: 'script', command: ['python3', './validators/check_syntax.py'] },
        { type: 'llm-rubric', value: ['Solution is simple and idiomatic Python'] },
      ],
    },
  ],
};

export default config;
```

## Documentation

Full docs at [agentv.dev/docs](https://agentv.dev/docs/getting-started/introduction/).

- [Eval files](https://agentv.dev/docs/evaluation/eval-files/) — format and structure
- [Custom assertions](https://agentv.dev/docs/graders/custom-assertions/) — reusable assertion types
- [Script graders](https://agentv.dev/docs/graders/script-graders/) — command-backed graders in any language
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
