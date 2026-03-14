# Migrating from Skill-Creator to AgentV Lifecycle Skill

This reference covers how to use AgentV's unified agent-evaluation lifecycle skill (`agentv-optimizer`) with evals.json files originally created for Anthropic's skill-creator.

## Drop-in Replacement

AgentV runs skill-creator's evals.json directly — no conversion required:

```bash
# Run evals.json with AgentV
agentv eval run evals.json

# Or in agent mode (no API keys)
agentv prompt eval evals.json
```

AgentV automatically:
- Promotes `prompt` → input messages
- Promotes `expected_output` → reference answer
- Converts `assertions` → LLM-judge evaluators
- Resolves `files[]` paths relative to the evals.json directory

## What You Gain

Moving from skill-creator's eval loop to AgentV's lifecycle skill gives you:

| Capability | skill-creator | AgentV lifecycle skill |
|-----------|---------------|----------------------|
| Workspace isolation | ❌ | ✅ Clone repos, run setup/teardown scripts |
| Code judges | ❌ | ✅ Python/TypeScript evaluator scripts via `defineCodeJudge()` |
| Tool trajectory scoring | ❌ | ✅ Evaluate tool call sequences |
| Multi-provider comparison | with-skill vs without-skill | N-way: Claude, GPT, Copilot, Gemini, custom CLI |
| Multi-turn evaluation | ❌ | ✅ Conversation tracking with `conversation_id` |
| Blind comparison | ❌ | ✅ Judge doesn't know which is baseline |
| Deterministic upgrade suggestions | ❌ | ✅ LLM-judge → contains/regex/is-json |
| Human review checkpoint | ❌ | ✅ Structured feedback gate |
| Workspace file tracking | ❌ | ✅ Evaluate by diffing workspace files |
| Agent mode (no API keys) | ❌ | ✅ Uses eval-grader agent in agent mode |

## Artifact Compatibility

AgentV's companion artifacts are compatible with skill-creator's eval-viewer:

| Artifact | Format | Compatible with eval-viewer |
|----------|--------|---------------------------|
| `grading.json` | Per-assertion evidence with claims | ✅ Superset of skill-creator's grading format |
| `benchmark.json` | Aggregate pass rates, timing, patterns | ✅ Superset of Agent Skills benchmark format |
| Results JSONL | Per-test results | ✅ Standard JSONL format |

AgentV's schemas are supersets — they include all fields skill-creator expects, plus additional fields (claims extraction, pattern analysis, deterministic upgrade candidates). Tools that read skill-creator artifacts will read AgentV artifacts correctly, ignoring the extra fields.

## Graduating to EVAL.yaml

When evals.json becomes limiting, convert to EVAL.yaml for the full feature set:

```bash
# Convert evals.json to EVAL.yaml
agentv convert evals.json

# Edit the generated YAML to add workspace config, code judges, etc.
# Then run with the full lifecycle
agentv prompt eval evals.eval.yaml
```

EVAL.yaml unlocks:
- **Workspace setup/teardown** — clone repos, install dependencies, clean up after tests
- **Code judges** — write evaluators in Python or TypeScript, not just LLM prompts
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
   - Deterministic upgrades (replace vague LLM judges with precise checks)
4. Use AgentV's optimization loop to refine the skill's prompts
5. Return to skill-creator for packaging and distribution
```
