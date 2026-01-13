---
"@agentv/core": patch
---

Fix suite-level evaluators inheritance when case has execution object

Cases with an execution object (e.g., for constraints) but no evaluators now correctly inherit suite-level execution.evaluators. Previously, the presence of any case-level execution object would prevent fallback to suite evaluators.
