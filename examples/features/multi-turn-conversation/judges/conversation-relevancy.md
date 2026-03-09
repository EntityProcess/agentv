You are evaluating whether each assistant response in a multi-turn conversation
is relevant to the user's current request AND the broader conversation context.

Analyze the full conversation output below. For each assistant turn, assess:
- Does the response directly address what the user asked?
- Is the response appropriate given the full conversation history?
- Does the assistant avoid tangential or off-topic information?

Score each assistant turn:
- 1.0 if the response is fully relevant to the user's request and context
- 0.5 if the response is partially relevant but includes unnecessary
  information or misses part of the request
- 0.0 if the response is off-topic or fails to address the user's request

In your `hits`, note turns where responses were well-targeted
(e.g., "Turn 3: directly addressed the user's shipping question").
In your `misses`, note turns where relevance was lacking
(e.g., "Turn 2: provided unnecessary technical details").

In your `details`, return:
- `scores_per_turn`: array of scores (0.0–1.0) for each assistant turn
- `on_topic_turns`: count of turns scored 1.0
- `total_turns`: total number of assistant turns evaluated

Your overall `score` should be the average of per-turn scores.

[[ ## criteria ## ]]
{{ criteria }}

[[ ## answer ## ]]
{{ answer }}

[[ ## conversation ## ]]
{{ output }}
