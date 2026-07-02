# 15. Multi-turn: separate conversation execution from evaluation

Date: 2026-07-02

## Status

Proposed. Part of the promptfoo-superset eval restructure — see
`docs/plans/promptfoo-aligned-eval-restructure.md` §3. Records a decision that
had no prior ADR (the `mode: conversation` contract lived only in code and in
issue #1053).

## Context

AgentV's multi-turn support (`mode: conversation`, `turns[]`, `aggregation`,
`on_turn_failure`, `window_size`) was designed under **agentv#1053** and
researched in `agentevals/agentevals-research/research/findings/multiturn-conversation-eval/`
against inspect-ai, google-adk, and ragas. Key findings:

- **inspect-ai**: solver `state.completed` ≡ AgentV `on_turn_failure: stop`;
  `await score(state)` inside a solver ≡ per-turn assertions gating
  continuation; the research recommends treating **conversation execution and
  conversation evaluation as separate concerns**.
- **google-adk**: schema separates scripted `conversation` from LLM-driven
  `conversation_scenario` (mutually exclusive; different metric sets).
- **inspect-ai / ragas / promptfoo all lack per-conversation aggregation** —
  they aggregate only across *epochs/samples*, never *within* one conversation.
  This is why AgentV added a turn-`aggregation` policy.

Separately, this restructure adopts promptfoo's prompt-variable system, which
brings native conversation **execution** for free: chat-array prompts, the
built-in `_conversation` variable (each test row is a turn, prior completions
looped into the prompt), and session-based providers for stateful threads.

`window_size` (verified in `orchestrator.ts` `buildWindowedHistory`): a sliding
window that, each turn, sends **all system messages + the last N turns**
(`N×2` non-system messages) to the provider and to the per-turn grader, instead
of the full accumulated history. Its purpose is context/cost control for long
conversations.

## Decision

1. **Split execution from evaluation** (per the inspect-ai finding).
2. **Conversation execution → promptfoo mechanisms**: `_conversation` +
   chat-array prompts for stateless/rebuild-history turns; session providers for
   stateful same-thread turns. AgentV does not keep a bespoke turn-driving
   subsystem.
3. **Keep AgentV's evaluation layer** as a documented extension: per-turn
   assertions, cross-turn **`aggregation`** (`mean` default, `min` = weakest
   link, `max`), and **`on_turn_failure`** (`continue`/`stop`). Provenance:
   `on_turn_failure` ← inspect-ai `state.completed`; per-conversation
   aggregation is a deliberate gap-fill for a capability the surveyed frameworks
   lack. Relying on promptfoo alone would reintroduce that gap.
4. **Drop `window_size`.** In the `_conversation` model the author controls how
   much history to include directly in the prompt template (include all, slice
   the last N, or summarize), so a dedicated schema field is redundant; it also
   has no framework pedigree. This reverses the `window_size` portion of the
   #1053 design.
5. **Turn-aggregation is a distinct axis from trial-aggregation.** Cross-turn
   `aggregation` (within one conversation) is separate from the
   `repeat`/pass@k reducer across samples/trials (ADR for the output contract,
   plan §4/§6). Both are retained on their respective axes; neither replaces the
   other.

## Migration: `window_size` → `_conversation` template

`window_size: N` kept *system + the last N turns* (`buildWindowedHistory`:
all system messages + the last `N×2` non-system messages) when calling the
provider and the per-turn grader. In the `_conversation` model the author
expresses the same windowing in the prompt template:

```njk
[
  { "role": "system", "content": "{{ system }}" },   {# always kept — outside the loop #}
  {% for c in _conversation %}
    {% if loop.revindex <= N %}                       {# keep last N turns == window_size: N #}
      { "role": "user",      "content": "{{ c.input }}"  },
      { "role": "assistant", "content": "{{ c.output }}" },
    {% endif %}
  {% endfor %}
  { "role": "user", "content": "{{ question }}" }
]
```

- `window_size` unset (full history) → loop over all of `_conversation` (drop the `if`).
- `window_size: N` → `{% if loop.revindex <= N %}` (each `_conversation` entry is one turn, so this is the last N turns = last `N×2` messages, matching `buildWindowedHistory`).
- The template is strictly more expressive — it can also **summarize** prior turns (via a `nunjucks_filters` filter or a var) rather than only truncate, which `window_size` could not do.

The codemod rewrites `window_size: N` scenarios into this template idiom.

## Compatibility

Major-version, hard deprecation (nothing in production). The one-shot codemod
removes `window_size` and reshapes authored `mode: conversation` scenarios so
that turn *execution* is expressed via `_conversation`/prompts while the
retained `turns` evaluation fields (per-turn `assert`, `aggregation`,
`on_turn_failure`) carry over. No prior ADR is superseded; this supersedes the
`window_size` intent recorded in issue #1053.
