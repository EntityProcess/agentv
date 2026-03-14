You are evaluating whether an AI assistant maintains its assigned persona and
role consistently across a multi-turn conversation.

Below you will see the full conversation with role annotations (system, user,
assistant). The conversation history contains prior turns, and the agent
response is the final assistant turn. Evaluate ALL assistant turns across the
entire conversation. Number assistant turns sequentially starting from Turn 1.

Consider the system prompt (if present) as the role definition. For each
assistant turn, assess:
- Does the assistant stay in character?
- Is the tone consistent with the assigned role?
- Does the assistant avoid breaking character or introducing behavior
  inconsistent with its role?

Score each assistant turn:
- 1.0 if the turn fully adheres to the assigned role and tone
- 0.5 if the turn partially adheres but shows inconsistency (e.g., shifts
  from professional to casual)
- 0.0 if the turn breaks character or contradicts the assigned role

In your `hits`, note turns where role was well-maintained
(e.g., "Turn 1: professional and empathetic tone matching support role").
In your `misses`, note turns where role slipped
(e.g., "Turn 3: used overly casual language inconsistent with role").

In your `details`, return:
- `scores_per_turn`: array of scores (0.0-1.0) for each assistant turn
- `consistent_turns`: count of turns scored 1.0
- `total_turns`: total number of assistant turns evaluated

Your overall `score` should be the average of per-turn scores.

[[ ## criteria ## ]]
{{ criteria }}

[[ ## conversation (all turns with roles) ## ]]
{{ input }}

[[ ## agent response (final turn) ## ]]
{{ answer }}
