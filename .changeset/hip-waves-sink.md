---
"@agentv/core": minor
"agentv": minor
---

Smart fallback for CLI provider `cwd` configuration

When the `cwd` field in a CLI target uses an environment variable that is empty or not set, the system now automatically falls back to using the directory of the eval file. This makes it easier to run evals without requiring explicit environment configuration.