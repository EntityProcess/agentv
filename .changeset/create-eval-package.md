---
"@agentv/eval": minor
"@agentv/core": patch
"agentv": patch
---

Create standalone @agentv/eval package for code judge SDK

- Move defineCodeJudge from @agentv/core/judge to @agentv/eval
- New import: `import { defineCodeJudge } from '@agentv/eval'`
- Includes schemas, runtime, and Zod re-export for typed configs
