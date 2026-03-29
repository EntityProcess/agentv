# Description Optimization

Optimize the `description` field in a skill's SKILL.md frontmatter for better triggering
accuracy. Use this after the agent/skill is working well — this is a polish step, not a
core workflow step.

**Provider compatibility**: Description optimization applies to any agent platform with
skill-discovery mechanisms — Claude Code, Codex (`.agents/` or `.codex/` folders), Copilot,
and others. The `skill-trigger` evaluator checks whether the agent invoked the right skill,
regardless of how discovery works on that platform.

## Step 1: Generate Trigger EVAL.yaml

Create 20 test cases:
- **10 should-trigger**: realistic prompts where this skill should activate — different
  phrasings, casual speech, uncommon use cases, edge cases where this skill competes with
  another but should win
- **10 should-not-trigger**: near-miss prompts that share keywords but actually need
  something different — adjacent domains, ambiguous phrasing where naive matching would
  trigger but shouldn't

Prompts must be realistic — include file paths, personal context, typos, casual speech.
Not abstract requests like "format data" but concrete ones like "ok so my boss sent me
Q4-sales-FINAL-v2.xlsx and she wants me to add a profit margin column..."

The should-not-trigger cases are the most valuable. "Write a fibonacci function" as a
negative test for an eval skill is useless — it doesn't test anything. The negative cases
should be genuinely tricky near-misses.

Write as EVAL.yaml with top-level input (the user prompt doesn't specify the skill name —
it's a natural utterance):

```yaml
# trigger-eval.eval.yaml
tests:
  - id: should-trigger-casual-optimize
    input: "ok so I have this agent that keeps failing on the code review tasks, can you help me figure out why and fix it"
    assertions:
      - type: skill-trigger
        skill_name: agentv-bench
  - id: should-not-trigger-build-error
    input: "my TypeScript build is failing with type errors in src/auth.ts"
    assertions:
      - type: skill-trigger
        skill_name: agentv-bench
        negate: true
```

## Step 2: Review with User

Present the eval set. The user adjusts queries, toggles should-trigger, adds/removes cases.
This step matters — bad eval queries lead to bad descriptions.

## Step 3: Iterate on Description

Run the trigger eval, identify misfires, rewrite the description, re-run. Max 5 iterations.
Select best description by held-out test accuracy (split 60% train / 40% test) to avoid
overfitting.

Use the grader and analyzer subagents to identify trigger failures and propose description
improvements — the same eval → grade → analyze → improve loop used for agent output quality.

## Step 4: Apply

Update the skill's SKILL.md frontmatter with the optimized description. Show the user
before/after with accuracy scores.
