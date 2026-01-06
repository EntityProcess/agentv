---
"@agentv/eval": minor
"@agentv/core": patch
"agentv": patch
---

Create @agentv/eval package and add pi-agent-sdk provider support

- Create standalone @agentv/eval package for code judge SDK with defineCodeJudge()
- Move defineCodeJudge from @agentv/core to @agentv/eval
- New import: `import { defineCodeJudge } from '@agentv/eval'`
- Includes schemas, runtime, and Zod re-export for typed configs
- Add pi-agent-sdk provider for multi-LLM provider support (Anthropic, OpenAI, Google, Mistral, Groq, Cerebras, xAI, OpenRouter)
