# Migrating from Skill-Creator to AgentV Lifecycle Skill

This reference covers how to use AgentV's unified agent-evaluation lifecycle skill (`agentv-bench`) with evals.json files originally created for Anthropic's skill-creator.

## Drop-in Replacement

AgentV runs skill-creator's evals.json directly — no conversion required:

```bash
# Run evals.json with AgentV
agentv eval evals.json

# Or in agent mode (no API keys)
agentv prompt eval --list evals.json
agentv prompt eval --input evals.json --test-id 1
agentv prompt eval --expected-output evals.json --test-id 1
```

AgentV automatically:
- Promotes `prompt` → input messages
- Promotes `expected_output` → reference answer
- Converts `assertions` → LLM-grader evaluators
- Resolves `files[]` paths relative to the evals.json directory

If you're using the `agentv-bench` skill, the bundled Bun scripts wrap these same commands and artifacts instead of inventing a second format:

```bash
cd plugins/agentv-dev/skills/agentv-bench
bun install
bun scripts/run-eval.ts --eval-path ../../../../examples/features/agent-skills-evals/evals.json --dry-run
bun scripts/prompt-eval.ts --list ../../../../examples/features/agent-skills-evals/evals.json
bun scripts/convert-evals.ts --eval-path ../../../../examples/features/agent-skills-evals/evals.json --out /tmp/eval.yaml
bun scripts/generate-report.ts --artifacts .agentv/artifacts --out /tmp/agentv-review.html
```

These scripts still call `agentv` wherever possible. Code graders, grading, and artifact generation remain in AgentV core; the scripts just orchestrate and summarize the existing outputs.

## What You Gain

Moving from skill-creator's eval loop to AgentV's lifecycle skill gives you:

| Capability | skill-creator | AgentV lifecycle skill |
|-----------|---------------|----------------------|
| Workspace isolation | ❌ | ✅ Clone repos, run setup/teardown scripts |
| Code graders | ❌ | ✅ Python/TypeScript evaluator scripts via `defineCodeGrader()` |
| Tool trajectory scoring | ❌ | ✅ Evaluate tool call sequences |
| Multi-provider comparison | with-skill vs without-skill | N-way: Claude, GPT, Copilot, Gemini, custom CLI |
| Multi-turn evaluation | ❌ | ✅ Conversation tracking with `conversation_id` |
| Blind comparison | ❌ | ✅ Judge doesn't know which is baseline |
| Deterministic upgrade suggestions | ❌ | ✅ LLM-grader → contains/regex/is-json |
| Human review checkpoint | ❌ | ✅ Structured feedback gate |
| Workspace file tracking | ❌ | ✅ Evaluate by diffing workspace files |
| Agent mode (no API keys) | ❌ | ✅ Uses grader agent in agent mode |

## Artifact Compatibility

AgentV's companion artifacts are compatible with skill-creator's eval-viewer:

| Artifact | Format | Compatible with eval-viewer |
|----------|--------|---------------------------|
| `grading.json` | Per-assertion evidence with claims | ✅ Superset of skill-creator's grading format |
| `benchmark.json` | Aggregate pass rates, timing, patterns | ✅ Superset of Agent Skills benchmark format |
| Results JSONL | Per-test results | ✅ Standard JSONL format |

AgentV's schemas are supersets — they include all fields skill-creator expects, plus additional fields (claims extraction, pattern analysis, deterministic upgrade candidates). Tools that read skill-creator artifacts will read AgentV artifacts correctly, ignoring the extra fields.

The optimizer scripts layer reads those same artifacts directly:
- `aggregate-benchmark.ts` consumes `benchmark.json`, `timing.json`, and results JSONL
- `generate-report.ts` and `eval-viewer/generate-review.ts` render review output from AgentV artifacts
- `improve-description.ts` proposes follow-up experiments from benchmark/grading observations

## Graduating to EVAL.yaml

When evals.json becomes limiting, convert to EVAL.yaml for the full feature set:

```bash
# Convert evals.json to EVAL.yaml
agentv convert evals.json

# Edit the generated YAML to add workspace config, code graders, etc.
# Then run with the full lifecycle
agentv eval eval.yaml
```

EVAL.yaml unlocks:
- **Workspace setup/teardown** — clone repos, install dependencies, clean up after tests
- **Code graders** — write evaluators in Python or TypeScript, not just LLM prompts
- **Rubric-based grading** — multi-dimensional scoring with weighted criteria
- **Retry policies** — automatic retries for flaky tests with configurable backoff
- **Test groups** — organize tests by category with shared config
- **Multi-turn conversations** — test agent interactions across multiple turns

## What Stays in Skill-Creator

AgentV does NOT replace these skill-creator capabilities:

- **Trigger optimization** — optimizing when/how a skill is triggered
- **.skill packaging** — bundling skills for distribution
- **Skill authoring** — creating new SKILL.md files from scratch
- **Skill discovery** — finding and installing skills

AgentV focuses on the **evaluation and optimization loop**. Skill-creator focuses on **skill authoring and packaging**. They are complementary — use skill-creator to write the skill, use AgentV to evaluate and optimize it.

## Example Workflow

```
1. Author a skill with skill-creator
2. skill-creator generates evals.json
3. Run evals.json through AgentV's lifecycle skill for richer evaluation:
   - Workspace isolation (test in a real repo)
   - Multi-provider comparison (does the skill work with GPT too?)
   - Blind comparison (is the new version actually better?)
   - Deterministic upgrades (replace vague LLM graders with precise checks)
4. Use AgentV's optimization loop to refine the skill's prompts
5. Return to skill-creator for packaging and distribution
```
