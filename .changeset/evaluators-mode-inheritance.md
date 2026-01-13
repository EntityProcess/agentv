---
"@agentv/core": patch
---

Fix evaluators_mode to support suite-level inheritance and remove undocumented "merge" alias

- Suite-level `evaluators_mode` now properly cascades to cases that don't specify their own
- Removed undocumented "merge" alias; only "append" is now accepted (consistent with schema)
