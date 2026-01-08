---
"@agentv/core": patch
---

Remove misleading `target_name` from target proxy metadata. Scripts can call multiple different targets via overrides, so the previous behavior of always reporting the default target was inaccurate. The `call_count` and `max_calls` fields remain unchanged.
