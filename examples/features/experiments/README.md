# Experiments

Demonstrates using the `--experiment` flag to compare evaluation runs under different conditions while keeping test cases identical.

## What This Shows

- Running the same eval file with different experiment labels
- Comparing results across experiments (e.g. with vs without skills)
- One run = one target x one experiment, recorded in `manifest.json`

## Concept

An **experiment** is a run-level label that records the conditions under which an eval was executed. The eval file stays the same — what changes is the environment (skills installed, web search enabled, different system prompt, etc.).

| Experiment | What changes | Eval file |
|---|---|---|
| `with_skills` | Skills installed in workspace | Same `coding-ability.eval.yaml` |
| `without_skills` | No skills in workspace | Same file |
| `web_search` | Web search tool enabled | Same file |

## Running

```bash
# From repository root

# Run with skills (set up workspace with skills first, then run)
agentv pipeline run examples/features/experiments/evals/coding-ability.eval.yaml \
  --experiment with_skills

# Run without skills (same eval, clean workspace)
agentv pipeline run examples/features/experiments/evals/coding-ability.eval.yaml \
  --experiment without_skills
```

The experiment label is written to `manifest.json` and propagated to `index.jsonl` entries by `pipeline bench`. This enables dashboards to filter and compare results by experiment.

## Output

Each run produces a separate directory. The experiment is metadata, not a path segment:

```
.agentv/results/runs/
├── 2026-03-28T10-00-00-000Z/       # with_skills run
│   ├── manifest.json                # { "experiment": "with_skills", ... }
│   └── coding-ability/
│       ├── review-null-check/
│       └── review-clean-function/
└── 2026-03-28T10-05-00-000Z/       # without_skills run
    ├── manifest.json                # { "experiment": "without_skills", ... }
    └── coding-ability/
        ├── review-null-check/
        └── review-clean-function/
```

## Comparing experiments

After both runs complete and are graded:

```bash
# Compare the two runs
agentv compare .agentv/results/runs/<with-skills-ts>/index.jsonl \
               .agentv/results/runs/<without-skills-ts>/index.jsonl
```

## Key Files

- `evals/coding-ability.eval.yaml` - Shared test cases (same for all experiments)
