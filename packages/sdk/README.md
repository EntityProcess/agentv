# @agentv/sdk

Internal workspace package for AgentV TypeScript SDK helper implementation.

This package is private and is not published to npm. User-facing TypeScript
imports are exposed by the public `agentv` package:

```typescript
import { evaluate, defineScriptGrader, defineAssertion, defineEval, graders } from 'agentv';
import { defineConfig } from 'agentv/config';
import type { Provider } from 'agentv/provider';
```

Keep CLI and Dashboard internals importing private workspace layers directly.
Do not make internal code depend on the public `agentv` facade.
