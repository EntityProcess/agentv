# @agentv/core

Internal workspace package for AgentV's evaluation engine, provider contracts,
artifact readers/writers, trace/session read models, project registry, and
shared runtime implementation.

This package is private and is not published to npm. Public user-facing
programmatic imports are exposed by the `agentv` package:

```typescript
import { evaluate } from 'agentv';
import { defineConfig } from 'agentv/config';
import type { Provider, ProviderRequest, ProviderResponse } from 'agentv/provider';
```

CLI, Dashboard, tests, and private workspace packages may import `@agentv/core`
directly. Public docs and examples should use `agentv`, `agentv/config`, or
`agentv/provider` unless they are explicitly describing repository internals.
