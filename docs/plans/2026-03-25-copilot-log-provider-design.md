# Copilot Log Provider — Passive Transcript Reading

## Problem

Evaluating Copilot CLI agent sessions currently requires spawning a CLI instance, costing 1 premium request per eval. We need zero-cost transcript reading by parsing session files directly from disk.

## Solution

New `copilot-log` provider kind that reads `~/.copilot/session-state/{uuid}/events.jsonl` and converts Copilot CLI events into AgentV's `Message[]` format. The existing skill-trigger evaluator works automatically since it already consumes `context.output[]`.

## Architecture

Three new modules in `packages/core/src/evaluation/providers/`:

```
copilot-log-parser.ts          — events.jsonl → Message[]
copilot-session-discovery.ts   — scan ~/.copilot/session-state/
copilot-log.ts                 — Provider wrapper
```

### Flow

```
External skill calls evaluate()
  → target: { provider: 'copilot-log', session_dir: '...' }
  → CopilotLogProvider.invoke()
    → reads events.jsonl from session_dir
    → parseCopilotEvents() converts events → Message[]
    → returns ProviderResponse { output: Message[] }
  → skill-trigger evaluator receives context.output[]
  → detects skill.invoked events via existing copilot-cli matcher
```

## Module Design

### 1. Parser (`copilot-log-parser.ts`)

Reads `events.jsonl` line-by-line and maps Copilot CLI events to AgentV types.

**Event mapping:**

| Copilot Event | AgentV Type |
|---|---|
| `user.message` | `Message { role: 'user', content }` |
| `assistant.message` | `Message { role: 'assistant', content, toolCalls }` |
| `tool.execution_start` + `tool.execution_complete` | `ToolCall { tool, input, output }` |
| `skill.invoked` | `ToolCall { tool: 'Skill', input: { skill: name } }` |
| `assistant.usage` | `Message.tokenUsage` |
| `session.start` / `session.shutdown` | Session metadata |

**API:**

```typescript
export interface CopilotSessionMeta {
  sessionId: string;
  model: string;
  cwd: string;
  repository?: string;
  branch?: string;
  startedAt: string;
}

export interface ParsedCopilotSession {
  messages: Message[];
  meta: CopilotSessionMeta;
  tokenUsage?: ProviderTokenUsage;
  costUsd?: number;
  durationMs?: number;
}

export function parseCopilotEvents(eventsJsonl: string): ParsedCopilotSession;
```

### 2. Session Discovery (`copilot-session-discovery.ts`)

Scans `~/.copilot/session-state/*/workspace.yaml` to find sessions.

**API:**

```typescript
export interface CopilotSession {
  sessionId: string;
  sessionDir: string;
  cwd: string;
  repository?: string;
  updatedAt: Date;
  isActive: boolean;  // no session.shutdown event
}

export function discoverCopilotSessions(opts?: {
  cwd?: string;               // filter by working directory
  repository?: string;        // filter by repo
  limit?: number;             // max results (default: 10)
  sessionStateDir?: string;   // override ~/.copilot/session-state
}): Promise<CopilotSession[]>; // sorted by updatedAt desc
```

**Discovery logic:**
1. Resolve session state dir (default: `~/.copilot/session-state`)
2. List subdirectories (each is a session UUID)
3. Read `workspace.yaml` from each for metadata
4. Check `events.jsonl` mtime for recency
5. Optionally check for `session.shutdown` event to determine active status
6. Filter by cwd/repository if specified
7. Sort by updatedAt descending

### 3. Provider (`copilot-log.ts`)

Read-only provider wrapping parser + discovery.

**Config:**

```typescript
interface CopilotLogConfig {
  session_dir?: string;        // explicit session directory path
  session_id?: string;         // explicit session UUID
  discover?: 'latest';         // auto-discover most recent session
  session_state_dir?: string;  // override ~/.copilot/session-state
}
```

**Behavior:**
- `invoke()` reads transcript from disk (ignores request.question for execution)
- Returns `ProviderResponse` with parsed `Message[]`
- No process spawned, zero cost

### 4. Registration Changes

**types.ts:** Add `'copilot-log'` to `ProviderKind`, `KNOWN_PROVIDERS`, `AGENT_PROVIDER_KINDS`

**providers/index.ts:** Register `copilot-log` factory

**targets.ts:** Add config resolution for `copilot-log`

**skill-trigger.ts:** Add `'copilot-log'` to copilot matcher aliases

## Programmatic API Usage

```typescript
import { evaluate } from '@agentv/core';

// Auto-discover latest session
const results = await evaluate({
  tests: [{
    id: 'skill-check',
    input: 'analyze csv data',
    assert: [{ type: 'skill-trigger', skill: 'csv-analyzer', should_trigger: true }],
  }],
  target: { provider: 'copilot-log', discover: 'latest' },
});

// Explicit session
const results2 = await evaluate({
  tests: [{ ... }],
  target: { provider: 'copilot-log', session_id: 'abc-123-uuid' },
});
```

## Non-Goals

- Real-time file watching (Phase 2)
- Modifying session files
- Cloud-based sessions
- Claude Code / Codex CLI parsers (Phase 3)
