# Copilot Log Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `copilot-log` provider that reads Copilot CLI session transcripts from disk (zero premium requests) and feeds them to the skill-trigger evaluator via the programmatic `evaluate()` API.

**Architecture:** Three new modules: a JSONL parser (`copilot-log-parser.ts`), a session discovery scanner (`copilot-session-discovery.ts`), and a provider wrapper (`copilot-log.ts`). The provider reads `~/.copilot/session-state/{uuid}/events.jsonl`, converts events to AgentV `Message[]`, and returns a `ProviderResponse`. The existing skill-trigger evaluator works automatically.

**Tech Stack:** TypeScript, Vitest, node:fs/promises, yaml (already in monorepo)

---

### Task 1: Copilot Log Parser — Tests

**Files:**
- Create: `packages/core/test/evaluation/providers/copilot-log-parser.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import {
  parseCopilotEvents,
  type ParsedCopilotSession,
} from '../../../src/evaluation/providers/copilot-log-parser.js';

function eventLine(type: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, ...data });
}

describe('parseCopilotEvents', () => {
  it('parses session.start into metadata', () => {
    const lines = [
      eventLine('session.start', {
        sessionId: 'abc-123',
        selectedModel: 'gpt-4o',
        context: { cwd: '/projects/app', repository: 'org/repo' },
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.meta.sessionId).toBe('abc-123');
    expect(result.meta.model).toBe('gpt-4o');
    expect(result.meta.cwd).toBe('/projects/app');
    expect(result.meta.repository).toBe('org/repo');
  });

  it('parses user.message into user Message', () => {
    const lines = [
      eventLine('user.message', { content: 'Hello agent' }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('Hello agent');
  });

  it('parses assistant.message into assistant Message', () => {
    const lines = [
      eventLine('assistant.message', {
        content: 'I will help you',
        toolRequests: [
          { toolName: 'Read File', arguments: { file_path: '/src/index.ts' } },
        ],
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toBe('I will help you');
    expect(result.messages[0].toolCalls).toHaveLength(1);
    expect(result.messages[0].toolCalls![0].tool).toBe('Read File');
    expect(result.messages[0].toolCalls![0].input).toEqual({ file_path: '/src/index.ts' });
  });

  it('parses skill.invoked as ToolCall with tool=Skill', () => {
    const lines = [
      eventLine('skill.invoked', {
        name: 'csv-analyzer',
        path: '/skills/csv-analyzer/SKILL.md',
        content: 'skill content',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0].tool).toBe('Skill');
    expect(assistantMsg!.toolCalls![0].input).toEqual({ skill: 'csv-analyzer' });
  });

  it('pairs tool.execution_start with tool.execution_complete', () => {
    const lines = [
      eventLine('tool.execution_start', {
        toolCallId: 'tc-1',
        toolName: 'Read File',
        arguments: { file_path: '/src/app.ts' },
      }),
      eventLine('tool.execution_complete', {
        toolCallId: 'tc-1',
        success: true,
        result: 'file contents',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0].tool).toBe('Read File');
    expect(assistantMsg!.toolCalls![0].output).toBe('file contents');
  });

  it('extracts token usage from assistant.usage', () => {
    const lines = [
      eventLine('assistant.usage', {
        inputTokens: 1000,
        outputTokens: 500,
        model: 'gpt-4o',
        cost: 0.025,
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.tokenUsage).toEqual({ input: 1000, output: 500 });
    expect(result.costUsd).toBe(0.025);
  });

  it('computes durationMs from session.start to session.shutdown', () => {
    const lines = [
      eventLine('session.start', {
        sessionId: 's1',
        selectedModel: 'gpt-4o',
        context: { cwd: '/app' },
        timestamp: '2026-03-25T10:00:00.000Z',
      }),
      eventLine('session.shutdown', {
        timestamp: '2026-03-25T10:01:30.000Z',
      }),
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.durationMs).toBe(90_000);
  });

  it('handles empty input gracefully', () => {
    const result = parseCopilotEvents('');
    expect(result.messages).toEqual([]);
    expect(result.meta.sessionId).toBe('');
    expect(result.meta.model).toBe('');
    expect(result.meta.cwd).toBe('');
  });

  it('skips malformed JSON lines', () => {
    const lines = [
      'not-json',
      eventLine('user.message', { content: 'valid line' }),
      '{broken',
    ].join('\n');

    const result = parseCopilotEvents(lines);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('valid line');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-log-parser.test.ts`
Expected: FAIL — module not found

---

### Task 2: Copilot Log Parser — Implementation

**Files:**
- Create: `packages/core/src/evaluation/providers/copilot-log-parser.ts`

**Step 1: Implement the parser**

```typescript
/**
 * Copilot CLI events.jsonl parser.
 *
 * Reads a Copilot CLI session transcript (events.jsonl) and converts it to
 * AgentV's Message[] format. Each line is a JSON object with a `type` field.
 *
 * Supported event types:
 *   session.start    → session metadata (sessionId, model, cwd)
 *   user.message     → Message { role: 'user' }
 *   assistant.message → Message { role: 'assistant', toolCalls from toolRequests }
 *   skill.invoked    → ToolCall { tool: 'Skill', input: { skill: name } }
 *   tool.execution_start + tool.execution_complete → ToolCall with output
 *   assistant.usage  → tokenUsage aggregation
 *   session.shutdown → session end timestamp
 *
 * To add a new event type:
 *   1. Add a case to the switch in parseCopilotEvents()
 *   2. Map it to a Message or ToolCall
 *   3. Add a test in copilot-log-parser.test.ts
 */

import type { Message, ProviderTokenUsage, ToolCall } from './types.js';

export interface CopilotSessionMeta {
  readonly sessionId: string;
  readonly model: string;
  readonly cwd: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly startedAt?: string;
}

export interface ParsedCopilotSession {
  readonly messages: Message[];
  readonly meta: CopilotSessionMeta;
  readonly tokenUsage?: ProviderTokenUsage;
  readonly costUsd?: number;
  readonly durationMs?: number;
}

interface ToolCallInProgress {
  readonly toolName: string;
  readonly input?: unknown;
  readonly toolCallId: string;
}

export function parseCopilotEvents(eventsJsonl: string): ParsedCopilotSession {
  const messages: Message[] = [];
  const meta: {
    sessionId: string;
    model: string;
    cwd: string;
    repository?: string;
    branch?: string;
    startedAt?: string;
  } = { sessionId: '', model: '', cwd: '' };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let hasUsage = false;
  let startTimestamp: string | undefined;
  let endTimestamp: string | undefined;

  // Track in-progress tool calls by ID
  const toolCallsInProgress = new Map<string, ToolCallInProgress>();

  const lines = eventsJsonl.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    const eventType = event.type as string | undefined;
    if (!eventType) continue;

    switch (eventType) {
      case 'session.start': {
        meta.sessionId = String(event.sessionId ?? '');
        meta.model = String(event.selectedModel ?? '');
        const ctx = event.context as Record<string, unknown> | undefined;
        meta.cwd = String(ctx?.cwd ?? '');
        meta.repository = ctx?.repository ? String(ctx.repository) : undefined;
        meta.branch = ctx?.branch ? String(ctx.branch) : undefined;
        meta.startedAt = event.timestamp ? String(event.timestamp) : undefined;
        startTimestamp = event.timestamp ? String(event.timestamp) : undefined;
        break;
      }

      case 'user.message': {
        messages.push({
          role: 'user',
          content: event.content != null ? String(event.content) : '',
        });
        break;
      }

      case 'assistant.message': {
        const toolRequests = event.toolRequests as
          | readonly { toolName: string; arguments?: unknown }[]
          | undefined;

        const toolCalls: ToolCall[] = (toolRequests ?? []).map((req) => ({
          tool: req.toolName,
          input: req.arguments,
        }));

        messages.push({
          role: 'assistant',
          content: event.content != null ? String(event.content) : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        break;
      }

      case 'skill.invoked': {
        const skillName = String(event.name ?? '');
        // Create an assistant message with a Skill tool call
        // This maps to the skill-trigger evaluator's Copilot matcher
        messages.push({
          role: 'assistant',
          toolCalls: [
            {
              tool: 'Skill',
              input: { skill: skillName },
            },
          ],
        });
        break;
      }

      case 'tool.execution_start': {
        const toolCallId = String(event.toolCallId ?? '');
        if (toolCallId) {
          toolCallsInProgress.set(toolCallId, {
            toolName: String(event.toolName ?? ''),
            input: event.arguments,
            toolCallId,
          });
        }
        break;
      }

      case 'tool.execution_complete': {
        const toolCallId = String(event.toolCallId ?? '');
        const started = toolCallsInProgress.get(toolCallId);
        if (started) {
          toolCallsInProgress.delete(toolCallId);
          messages.push({
            role: 'assistant',
            toolCalls: [
              {
                tool: started.toolName,
                input: started.input,
                output: event.result,
                id: toolCallId,
              },
            ],
          });
        }
        break;
      }

      case 'assistant.usage': {
        hasUsage = true;
        totalInputTokens += Number(event.inputTokens ?? 0);
        totalOutputTokens += Number(event.outputTokens ?? 0);
        totalCost += Number(event.cost ?? 0);
        break;
      }

      case 'session.shutdown': {
        endTimestamp = event.timestamp ? String(event.timestamp) : undefined;
        break;
      }
    }
  }

  let durationMs: number | undefined;
  if (startTimestamp && endTimestamp) {
    durationMs = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  }

  return {
    messages,
    meta,
    tokenUsage: hasUsage ? { input: totalInputTokens, output: totalOutputTokens } : undefined,
    costUsd: hasUsage && totalCost > 0 ? totalCost : undefined,
    durationMs,
  };
}
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-log-parser.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/evaluation/providers/copilot-log-parser.ts packages/core/test/evaluation/providers/copilot-log-parser.test.ts
git commit -m "feat(copilot-log): add events.jsonl parser with tests (#733)"
```

---

### Task 3: Session Discovery — Tests

**Files:**
- Create: `packages/core/test/evaluation/providers/copilot-session-discovery.test.ts`

**Step 1: Write the failing tests**

```typescript
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverCopilotSessions } from '../../../src/evaluation/providers/copilot-session-discovery.js';

describe('discoverCopilotSessions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'copilot-discovery-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSession(
    sessionId: string,
    workspaceYaml: string,
    eventsJsonl = '',
  ) {
    const sessionDir = path.join(tempDir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'workspace.yaml'), workspaceYaml);
    if (eventsJsonl) {
      await writeFile(path.join(sessionDir, 'events.jsonl'), eventsJsonl);
    }
    return sessionDir;
  }

  it('discovers sessions in session-state directory', async () => {
    await createSession('uuid-1', 'cwd: /projects/app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /projects/app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions).toHaveLength(2);
  });

  it('filters sessions by cwd', async () => {
    await createSession('uuid-1', 'cwd: /projects/app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /projects/other\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      cwd: '/projects/app',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('uuid-1');
  });

  it('filters sessions by repository', async () => {
    await createSession('uuid-1', 'cwd: /a\nrepository: org/repo\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /b\nrepository: org/other\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      repository: 'org/repo',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('uuid-1');
  });

  it('sorts sessions by updatedAt descending', async () => {
    await createSession('uuid-old', 'cwd: /app\n', '{"type":"session.start"}\n');
    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await createSession('uuid-new', 'cwd: /app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions[0].sessionId).toBe('uuid-new');
  });

  it('respects limit parameter', async () => {
    await createSession('uuid-1', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession('uuid-2', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession('uuid-3', 'cwd: /app\n', '{"type":"session.start"}\n');

    const sessions = await discoverCopilotSessions({
      sessionStateDir: tempDir,
      limit: 2,
    });
    expect(sessions).toHaveLength(2);
  });

  it('detects active sessions (no session.shutdown)', async () => {
    await createSession('uuid-active', 'cwd: /app\n', '{"type":"session.start"}\n');
    await createSession(
      'uuid-done',
      'cwd: /app\n',
      '{"type":"session.start"}\n{"type":"session.shutdown"}\n',
    );

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    const active = sessions.find((s) => s.sessionId === 'uuid-active');
    const done = sessions.find((s) => s.sessionId === 'uuid-done');
    expect(active?.isActive).toBe(true);
    expect(done?.isActive).toBe(false);
  });

  it('returns empty array for nonexistent directory', async () => {
    const sessions = await discoverCopilotSessions({
      sessionStateDir: '/nonexistent/path',
    });
    expect(sessions).toEqual([]);
  });

  it('skips directories without workspace.yaml', async () => {
    const sessionDir = path.join(tempDir, 'uuid-broken');
    await mkdir(sessionDir, { recursive: true });
    // No workspace.yaml — should be skipped

    const sessions = await discoverCopilotSessions({ sessionStateDir: tempDir });
    expect(sessions).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-session-discovery.test.ts`
Expected: FAIL — module not found

---

### Task 4: Session Discovery — Implementation

**Files:**
- Create: `packages/core/src/evaluation/providers/copilot-session-discovery.ts`

**Step 1: Implement session discovery**

```typescript
/**
 * Copilot CLI session discovery.
 *
 * Scans ~/.copilot/session-state/ for session directories containing
 * workspace.yaml and events.jsonl. Returns sessions sorted by recency.
 *
 * Each session directory is a UUID containing:
 *   workspace.yaml  — session metadata (cwd, repository)
 *   events.jsonl    — event transcript
 *
 * To extend filtering:
 *   1. Add a new option to DiscoverOptions
 *   2. Add filter logic in the sessions.filter() chain
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CopilotSession {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly cwd: string;
  readonly repository?: string;
  readonly updatedAt: Date;
  readonly isActive: boolean;
}

export interface DiscoverOptions {
  /** Filter sessions by working directory (exact match). */
  readonly cwd?: string;
  /** Filter sessions by repository name (exact match). */
  readonly repository?: string;
  /** Maximum number of sessions to return (default: 10). */
  readonly limit?: number;
  /** Override the default ~/.copilot/session-state directory. */
  readonly sessionStateDir?: string;
}

const DEFAULT_SESSION_STATE_DIR = () => path.join(homedir(), '.copilot', 'session-state');

export async function discoverCopilotSessions(opts?: DiscoverOptions): Promise<CopilotSession[]> {
  const sessionStateDir = opts?.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR();
  const limit = opts?.limit ?? 10;

  let entries: string[];
  try {
    entries = await readdir(sessionStateDir);
  } catch {
    return [];
  }

  const sessions: CopilotSession[] = [];

  for (const entry of entries) {
    const sessionDir = path.join(sessionStateDir, entry);
    const workspacePath = path.join(sessionDir, 'workspace.yaml');
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    try {
      const workspaceContent = await readFile(workspacePath, 'utf8');
      const workspace = parseSimpleYaml(workspaceContent);

      const cwd = String(workspace.cwd ?? '');

      // Check mtime of events.jsonl for recency
      let updatedAt: Date;
      try {
        const eventsStat = await stat(eventsPath);
        updatedAt = eventsStat.mtime;
      } catch {
        updatedAt = new Date(0);
      }

      // Check for session.shutdown to determine active status
      let isActive = true;
      try {
        const eventsContent = await readFile(eventsPath, 'utf8');
        isActive = !eventsContent.includes('"session.shutdown"');
      } catch {
        // No events file — treat as active
      }

      sessions.push({
        sessionId: entry,
        sessionDir,
        cwd,
        repository: workspace.repository ? String(workspace.repository) : undefined,
        updatedAt,
        isActive,
      });
    } catch {
      // Skip directories without valid workspace.yaml
      continue;
    }
  }

  // Filter
  let filtered = sessions;
  if (opts?.cwd) {
    filtered = filtered.filter((s) => s.cwd === opts.cwd);
  }
  if (opts?.repository) {
    filtered = filtered.filter((s) => s.repository === opts.repository);
  }

  // Sort by updatedAt descending
  filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return filtered.slice(0, limit);
}

/**
 * Minimal YAML parser for workspace.yaml files.
 * Only handles flat key: value pairs (no nesting, no arrays).
 */
function parseSimpleYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-session-discovery.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/evaluation/providers/copilot-session-discovery.ts packages/core/test/evaluation/providers/copilot-session-discovery.test.ts
git commit -m "feat(copilot-log): add session discovery with tests (#733)"
```

---

### Task 5: Provider Registration — Types & Skill-Trigger

**Files:**
- Modify: `packages/core/src/evaluation/providers/types.ts:13-48` — add `copilot-log` to ProviderKind, AGENT_PROVIDER_KINDS, KNOWN_PROVIDERS
- Modify: `packages/core/src/evaluation/evaluators/skill-trigger.ts:104-115` — add `copilot-log` to PROVIDER_TOOL_SEMANTICS

**Step 1: Add `copilot-log` to ProviderKind union**

In `packages/core/src/evaluation/providers/types.ts`, add `'copilot-log'` to the `ProviderKind` type (after `'copilot-cli'` on line 21):

```typescript
// Line 21, add after 'copilot-cli':
  | 'copilot-log'
```

**Step 2: Add to AGENT_PROVIDER_KINDS**

In `types.ts`, add `'copilot-log'` to `AGENT_PROVIDER_KINDS` (after `'copilot-cli'` on line 40):

```typescript
// After 'copilot-cli', add:
  'copilot-log',
```

**Step 3: Add to KNOWN_PROVIDERS**

In `types.ts`, add `'copilot-log'` to `KNOWN_PROVIDERS` (after `'copilot-cli'` on line 58):

```typescript
// After 'copilot-cli', add:
  'copilot-log',
```

**Step 4: Add to skill-trigger matcher**

In `packages/core/src/evaluation/evaluators/skill-trigger.ts`, add to `PROVIDER_TOOL_SEMANTICS` (after line 112):

```typescript
  'copilot-log': COPILOT_MATCHER,
```

The `copilot-log` provider emits `ToolCall { tool: 'Skill', input: { skill: name } }` which matches the existing `COPILOT_MATCHER`.

**Step 5: Run existing skill-trigger tests**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/evaluators/skill-trigger.test.ts`
Expected: ALL PASS (no regressions)

**Step 6: Commit**

```bash
git add packages/core/src/evaluation/providers/types.ts packages/core/src/evaluation/evaluators/skill-trigger.ts
git commit -m "feat(copilot-log): register provider kind and skill-trigger matcher (#733)"
```

---

### Task 6: Add copilot-log Skill-Trigger Test

**Files:**
- Modify: `packages/core/test/evaluation/evaluators/skill-trigger.test.ts`

**Step 1: Add test for copilot-log provider kind**

Append this test to the `describe('provider tool resolution')` block in `skill-trigger.test.ts`:

```typescript
    it('should resolve copilot-log to Copilot tool names', () => {
      const evaluator = new SkillTriggerEvaluator(makeConfig());
      const context = makeContext({
        provider: { kind: 'copilot-log', targetName: 'test' },
        output: [
          {
            role: 'assistant',
            toolCalls: [{ tool: 'Skill', input: { skill: 'csv-analyzer' } }],
          },
        ],
      });
      const result = evaluator.evaluate(context);
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1);
    });
```

**Step 2: Run tests**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/evaluators/skill-trigger.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/test/evaluation/evaluators/skill-trigger.test.ts
git commit -m "test(skill-trigger): add copilot-log provider kind test (#733)"
```

---

### Task 7: Provider Implementation — Tests

**Files:**
- Create: `packages/core/test/evaluation/providers/copilot-log.test.ts`

**Step 1: Write the failing tests**

```typescript
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CopilotLogProvider } from '../../../src/evaluation/providers/copilot-log.js';

describe('CopilotLogProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'copilot-log-provider-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSession(sessionId: string, events: string) {
    const sessionDir = path.join(tempDir, sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'workspace.yaml'), `cwd: /projects/app\n`);
    await writeFile(path.join(sessionDir, 'events.jsonl'), events);
    return sessionDir;
  }

  it('reads transcript from explicit session_dir', async () => {
    const sessionDir = await createSession('s1', [
      JSON.stringify({ type: 'user.message', content: 'hello' }),
      JSON.stringify({ type: 'assistant.message', content: 'hi', toolRequests: [] }),
    ].join('\n'));

    const provider = new CopilotLogProvider('test', { sessionDir });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output!.length).toBeGreaterThan(0);
    expect(response.output![0].role).toBe('user');
    expect(response.output![0].content).toBe('hello');
  });

  it('reads transcript from session_id + session_state_dir', async () => {
    await createSession('uuid-abc', [
      JSON.stringify({ type: 'user.message', content: 'test input' }),
    ].join('\n'));

    const provider = new CopilotLogProvider('test', {
      sessionId: 'uuid-abc',
      sessionStateDir: tempDir,
    });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output![0].content).toBe('test input');
  });

  it('auto-discovers latest session with discover=latest', async () => {
    await createSession('uuid-old', [
      JSON.stringify({ type: 'user.message', content: 'old' }),
    ].join('\n'));
    await new Promise((r) => setTimeout(r, 50));
    await createSession('uuid-new', [
      JSON.stringify({ type: 'user.message', content: 'new' }),
    ].join('\n'));

    const provider = new CopilotLogProvider('test', {
      discover: 'latest',
      sessionStateDir: tempDir,
    });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.output).toBeDefined();
    expect(response.output![0].content).toBe('new');
  });

  it('returns token usage and cost from transcript', async () => {
    const sessionDir = await createSession('s1', [
      JSON.stringify({ type: 'assistant.usage', inputTokens: 500, outputTokens: 200, cost: 0.01 }),
    ].join('\n'));

    const provider = new CopilotLogProvider('test', { sessionDir });
    const response = await provider.invoke({ question: 'ignored' });

    expect(response.tokenUsage).toEqual({ input: 500, output: 200 });
    expect(response.costUsd).toBe(0.01);
  });

  it('throws when no session found', async () => {
    const provider = new CopilotLogProvider('test', {
      sessionId: 'nonexistent',
      sessionStateDir: tempDir,
    });

    await expect(provider.invoke({ question: 'x' })).rejects.toThrow();
  });

  it('has correct provider metadata', () => {
    const provider = new CopilotLogProvider('my-target', { sessionDir: '/tmp/s1' });
    expect(provider.id).toBe('copilot-log:my-target');
    expect(provider.kind).toBe('copilot-log');
    expect(provider.targetName).toBe('my-target');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-log.test.ts`
Expected: FAIL — module not found

---

### Task 8: Provider Implementation

**Files:**
- Create: `packages/core/src/evaluation/providers/copilot-log.ts`

**Step 1: Implement the provider**

```typescript
/**
 * Copilot Log provider — reads Copilot CLI session transcripts from disk.
 *
 * Zero-cost alternative to spawning a Copilot CLI instance. Reads
 * ~/.copilot/session-state/{uuid}/events.jsonl and converts to Message[].
 *
 * Config options (specify ONE of these to identify the session):
 *   sessionDir      — explicit path to a session directory
 *   sessionId       — session UUID (combined with sessionStateDir)
 *   discover        — 'latest' to auto-discover most recent session
 *
 * Optional:
 *   sessionStateDir — override ~/.copilot/session-state
 *   cwd             — filter discovery by working directory
 *
 * The invoke() method ignores request.question since no process is spawned.
 * It reads the transcript file and returns a ProviderResponse with the
 * parsed Message[] in the output field.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseCopilotEvents } from './copilot-log-parser.js';
import { discoverCopilotSessions } from './copilot-session-discovery.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

export interface CopilotLogResolvedConfig {
  /** Explicit path to a session directory containing events.jsonl. */
  readonly sessionDir?: string;
  /** Session UUID — combined with sessionStateDir to build the path. */
  readonly sessionId?: string;
  /** Auto-discovery mode. 'latest' picks the most recent session. */
  readonly discover?: 'latest';
  /** Override the default ~/.copilot/session-state directory. */
  readonly sessionStateDir?: string;
  /** Filter discovery by working directory. */
  readonly cwd?: string;
}

export class CopilotLogProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-log' as const;
  readonly targetName: string;

  private readonly config: CopilotLogResolvedConfig;

  constructor(targetName: string, config: CopilotLogResolvedConfig) {
    this.targetName = targetName;
    this.id = `copilot-log:${targetName}`;
    this.config = config;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    const sessionDir = await this.resolveSessionDir();
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    let eventsContent: string;
    try {
      eventsContent = await readFile(eventsPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Failed to read Copilot session transcript at ${eventsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseCopilotEvents(eventsContent);

    return {
      output: parsed.messages,
      tokenUsage: parsed.tokenUsage,
      costUsd: parsed.costUsd,
      durationMs: parsed.durationMs,
      startTime: parsed.meta.startedAt,
    };
  }

  private async resolveSessionDir(): Promise<string> {
    // Explicit session directory
    if (this.config.sessionDir) {
      return this.config.sessionDir;
    }

    // Session ID + state dir
    if (this.config.sessionId) {
      const stateDir = this.config.sessionStateDir ?? path.join(homedir(), '.copilot', 'session-state');
      return path.join(stateDir, this.config.sessionId);
    }

    // Auto-discover
    if (this.config.discover === 'latest') {
      const sessions = await discoverCopilotSessions({
        sessionStateDir: this.config.sessionStateDir,
        cwd: this.config.cwd,
        limit: 1,
      });

      if (sessions.length === 0) {
        throw new Error(
          `No Copilot CLI sessions found${this.config.cwd ? ` for cwd=${this.config.cwd}` : ''}. ` +
          `Check that sessions exist in ${this.config.sessionStateDir ?? '~/.copilot/session-state/'}`,
        );
      }

      return sessions[0].sessionDir;
    }

    throw new Error(
      'CopilotLogProvider requires one of: sessionDir, sessionId, or discover="latest"',
    );
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun vitest run packages/core/test/evaluation/providers/copilot-log.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/evaluation/providers/copilot-log.ts packages/core/test/evaluation/providers/copilot-log.test.ts
git commit -m "feat(copilot-log): add provider with session resolution (#733)"
```

---

### Task 9: Wire Up — Targets & Provider Registry

**Files:**
- Modify: `packages/core/src/evaluation/providers/targets.ts` — add `CopilotLogResolvedConfig` to `ResolvedTarget` union, add `resolveCopilotLogConfig()`, add case to switch
- Modify: `packages/core/src/evaluation/providers/index.ts` — import and register provider, export config type

**Step 1: Add config interface and resolution to targets.ts**

Add the `CopilotLogResolvedConfig` import and `ResolvedTarget` union variant. The config resolution is simple since copilot-log has no executable or timeout:

In `targets.ts`, after the `CopilotCliResolvedConfig` interface (around line 473), add a reference comment. The actual config type lives in `copilot-log.ts` — import and re-export it.

Add to the `ResolvedTarget` union (after the `copilot-cli` variant around line 624):

```typescript
  | {
      readonly kind: 'copilot-log';
      readonly name: string;
      readonly graderTarget?: string;
      readonly workers?: number;
      readonly providerBatching?: boolean;
      readonly config: CopilotLogResolvedConfig;
    }
```

Add to the `resolveTargetDefinition` switch (after the `copilot-cli` case around line 868):

```typescript
    case 'copilot-log':
      return {
        kind: 'copilot-log',
        name: parsed.name,
        graderTarget: parsed.grader_target ?? parsed.judge_target,
        workers: parsed.workers,
        providerBatching,
        config: resolveCopilotLogConfig(parsed, env),
      };
```

Add the resolution function (at end of file, before closing):

```typescript
function resolveCopilotLogConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): CopilotLogResolvedConfig {
  const sessionDirSource = target.session_dir ?? target.sessionDir;
  const sessionIdSource = target.session_id ?? target.sessionId;
  const discoverSource = target.discover;
  const sessionStateDirSource = target.session_state_dir ?? target.sessionStateDir;
  const cwdSource = target.cwd;

  return {
    sessionDir: resolveOptionalString(sessionDirSource, env, `${target.name} copilot-log session_dir`, { allowLiteral: true, optionalEnv: true }),
    sessionId: resolveOptionalString(sessionIdSource, env, `${target.name} copilot-log session_id`, { allowLiteral: true, optionalEnv: true }),
    discover: discoverSource === 'latest' ? 'latest' : undefined,
    sessionStateDir: resolveOptionalString(sessionStateDirSource, env, `${target.name} copilot-log session_state_dir`, { allowLiteral: true, optionalEnv: true }),
    cwd: resolveOptionalString(cwdSource, env, `${target.name} copilot-log cwd`, { allowLiteral: true, optionalEnv: true }),
  };
}
```

**Step 2: Import `CopilotLogResolvedConfig` in targets.ts**

Add at top of targets.ts:
```typescript
import type { CopilotLogResolvedConfig } from './copilot-log.js';
```

And re-export it alongside other config types.

**Step 3: Register in index.ts**

In `packages/core/src/evaluation/providers/index.ts`:

Add import (around line 14):
```typescript
import { CopilotLogProvider } from './copilot-log.js';
```

Add to exported types (around line 45):
```typescript
  CopilotLogResolvedConfig,
```

Add registration (after line 101):
```typescript
    .register('copilot-log', (t) => new CopilotLogProvider(t.name, t.config as never))
```

Add export for session discovery (around line 77):
```typescript
export { discoverCopilotSessions, type CopilotSession } from './copilot-session-discovery.js';
```

**Step 4: Run build and full test suite**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun run build && bun run typecheck && bun vitest run`
Expected: ALL PASS, no type errors

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/providers/targets.ts packages/core/src/evaluation/providers/index.ts
git commit -m "feat(copilot-log): wire up targets, registry, and exports (#733)"
```

---

### Task 10: Full Integration Test & Cleanup

**Step 1: Run full test suite**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun run build && bun run typecheck && bun run lint && bun vitest run`
Expected: ALL PASS

**Step 2: Run validate:examples**

Run: `cd /home/christso/projects/agentv.worktrees/feat/733-copilot-log-provider && bun run validate:examples`
Expected: ALL PASS (no regressions — we didn't change YAML schema)

**Step 3: Delete design/plan docs before merge**

```bash
rm docs/plans/2026-03-25-copilot-log-provider-design.md
rm docs/plans/2026-03-25-copilot-log-provider-plan.md
git add -u docs/plans/
git commit -m "chore: remove implementation plan docs (#733)"
```

**Step 4: Push and create PR**

```bash
git push -u origin feat/733-copilot-log-provider
gh pr create --title "feat(skill-trigger): passive transcript reading via copilot-log provider" --body "$(cat <<'EOF'
## Summary
- Adds `copilot-log` provider that reads Copilot CLI session transcripts from `~/.copilot/session-state/{uuid}/events.jsonl`
- Zero premium requests — pure filesystem reads
- Session discovery scans `workspace.yaml` metadata, filters by cwd/repo, sorts by recency
- Skill-trigger evaluator works automatically via existing COPILOT_MATCHER

Closes #733

## Test plan
- [ ] Unit tests for parser (event mapping, edge cases, malformed input)
- [ ] Unit tests for session discovery (filtering, sorting, limits, missing dirs)
- [ ] Unit tests for provider (explicit session, auto-discovery, error handling)
- [ ] Skill-trigger test for copilot-log provider kind
- [ ] Build + typecheck + lint pass
- [ ] Existing tests unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
