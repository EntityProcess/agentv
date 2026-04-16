You are evaluating whether an AI agent completed a task WITHOUT using a skill.

[[ ## question ## ]]
{{ input }}

[[ ## criteria ## ]]
{{ criteria }}

[[ ## answer ## ]]
{{ output }}

[[ ## tool_calls ## ]]
{{ tool_calls }}

Based on the tool calls above, determine whether the agent completed the task using only basic tools (Read, Edit, Bash, etc.) without invoking any Skill tool. Score 1.0 if no Skill tool was used, 0.0 if a Skill tool was invoked.
