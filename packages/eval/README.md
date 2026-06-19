# @agentv/eval

Deprecated compatibility package for the AgentV TypeScript SDK.

Use `@agentv/sdk` for new code:

```bash
npm uninstall @agentv/eval
npm install @agentv/sdk
```

```typescript
import { defineCodeGrader } from '@agentv/sdk';
```

This package temporarily re-exports the same helper surface because
`@agentv/eval` shipped before the SDK rename. It exists only as a migration
bridge for existing consumers.

## License

MIT License - see [LICENSE](../../LICENSE) for details.
