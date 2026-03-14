You are evaluating whether an AI assistant retains context from earlier turns
in a multi-turn conversation.

Below you will see the full conversation with role annotations (system, user,
assistant). The conversation history contains prior turns, and the agent
response is the final assistant turn. Evaluate ALL assistant turns across the
entire conversation. Number assistant turns sequentially starting from Turn 1.

For each assistant turn, check whether the assistant correctly references or
builds on information introduced in previous turns (e.g., names, numbers,
constraints, preferences).

Score each assistant turn:
- 1.0 if the turn demonstrates awareness of relevant earlier context
- 0.5 if the turn partially retains context (e.g., remembers some details but
  forgets others)
- 0.0 if the turn ignores or contradicts earlier context

In your `hits`, reference specific turns where context was retained
(e.g., "Turn 2: correctly recalled customer name").
In your `misses`, reference specific turns where context was lost
(e.g., "Turn 4: forgot delivery deadline from turn 1").

In your `details`, return:
- `scores_per_turn`: array of scores (0.0-1.0) for each assistant turn
- `relevant_turns`: count of turns that demonstrated context retention
- `total_turns`: total number of assistant turns evaluated

Your overall `score` should be the average of per-turn scores.

[[ ## criteria ## ]]
{{ criteria }}

[[ ## conversation (all turns with roles) ## ]]
{{ input }}

[[ ## agent response (final turn) ## ]]
{{ answer }}
