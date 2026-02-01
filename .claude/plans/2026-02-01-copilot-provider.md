# Copilot CLI Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a built-in `copilot-cli` provider that invokes GitHub Copilot CLI as an external process for agent evaluations.

**Architecture:** Mirrors the codex/claude-code provider pattern — spawns copilot CLI with `-p <prompt> -s --allow-all-tools --no-color`, captures stdout as plain text response. Uses the same preread prompt construction, workspace management, and stream logging patterns.

**Tech Stack:** TypeScript, Bun, Vitest, Zod

**Working directory:** `/home/christso/projects/agentv_feat-copilot-provider` (git worktree, branch: `feat/add-copilot-cli-provider-openspec`)

**Setup:** A git worktree has already been created at the working directory above, on branch `feat/add-copilot-cli-provider-openspec`, rebased onto `main`. All implementation work should happen in this worktree. Do NOT cd to the main repo at `/home/christso/projects/agentv`.

---

## Task 1: Register copilot-cli in type system

**Files:**
- Modify: `packages/core/src/evaluation/providers/types.ts`

**Step 1: Add copilot-cli to ProviderKind union**

In `types.ts`, add `'copilot-cli'` to the `ProviderKind` type union (after `'codex'`):

```typescript
export type ProviderKind =
  | 'azure'
  | 'anthropic'
  | 'gemini'
  | 'codex'
  | 'copilot-cli'   // <-- ADD
  | 'pi-coding-agent'
  // ...rest unchanged
```

**Step 2: Add to AGENT_PROVIDER_KINDS**

Add `'copilot-cli'` to the `AGENT_PROVIDER_KINDS` array (it has filesystem access):

```typescript
export const AGENT_PROVIDER_KINDS: readonly ProviderKind[] = [
  'codex',
  'copilot-cli',  // <-- ADD
  'pi-coding-agent',
  // ...rest
] as const;
```

**Step 3: Add to KNOWN_PROVIDERS**

Add `'copilot-cli'` to the `KNOWN_PROVIDERS` array:

```typescript
export const KNOWN_PROVIDERS: readonly ProviderKind[] = [
  // ...existing
  'codex',
  'copilot-cli',  // <-- ADD
  // ...rest
] as const;
```

**Step 4: Add aliases**

Add `'copilot'` and `'github-copilot'` to `PROVIDER_ALIASES`:

```typescript
export const PROVIDER_ALIASES: readonly string[] = [
  // ...existing
  'copilot',          // alias for "copilot-cli"
  'github-copilot',   // alias for "copilot-cli"
] as const;
```

**Step 5: Add system_prompt to TargetDefinition**

Ensure `system_prompt` and `systemPrompt` exist in `TargetDefinition` (check if already present for codex/claude-code):

```typescript
readonly system_prompt?: string | unknown | undefined;
readonly systemPrompt?: string | unknown | undefined;
```

**Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: Compilation error in `providers/index.ts` because `createProvider` switch is not exhaustive (missing `'copilot-cli'` case). This is expected — we'll fix it in Task 4.

**Step 7: Commit**

```bash
git add packages/core/src/evaluation/providers/types.ts
git commit -m "feat(core): register copilot-cli provider kind and aliases"
```

---

## Task 2: Add CopilotResolvedConfig and target resolution

**Files:**
- Modify: `packages/core/src/evaluation/providers/targets.ts`

**Step 1: Add CopilotResolvedConfig interface**

After `CodexResolvedConfig`, add:

```typescript
export interface CopilotResolvedConfig {
  readonly executable: string;
  readonly model?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly logDir?: string;
  readonly logFormat?: 'summary' | 'json';
  readonly systemPrompt?: string;
}
```

**Step 2: Add copilot-cli to ResolvedTarget union**

Add a new union member to `ResolvedTarget`:

```typescript
| {
    readonly kind: 'copilot-cli';
    readonly name: string;
    readonly judgeTarget?: string;
    readonly workers?: number;
    readonly providerBatching?: boolean;
    readonly config: CopilotResolvedConfig;
  }
```

**Step 3: Add resolveCopilotConfig function**

Follow the same pattern as `resolveCodexConfig`:

```typescript
function resolveCopilotConfig(
  target: z.infer<typeof BASE_TARGET_SCHEMA>,
  env: EnvLookup,
): CopilotResolvedConfig {
  const executableSource = target.executable ?? target.command ?? target.binary;
  const modelSource = target.model;
  const argsSource = target.args ?? target.arguments;
  const cwdSource = target.cwd;
  const timeoutSource = target.timeout_seconds ?? target.timeoutSeconds;
  const logDirSource =
    target.log_dir ?? target.logDir ?? target.log_directory ?? target.logDirectory;
  const logFormatSource =
    target.log_format ?? target.logFormat ?? target.log_output_format ?? target.logOutputFormat;
  const systemPromptSource = target.system_prompt ?? target.systemPrompt;

  const executable =
    resolveOptionalString(executableSource, env, `${target.name} copilot executable`, {
      allowLiteral: true,
      optionalEnv: true,
    }) ?? 'copilot';

  const model = resolveOptionalString(modelSource, env, `${target.name} copilot model`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const args = resolveOptionalStringArray(argsSource, env, `${target.name} copilot args`);

  const cwd = resolveOptionalString(cwdSource, env, `${target.name} copilot cwd`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const timeoutMs = resolveTimeoutMs(timeoutSource, `${target.name} copilot timeout`);

  const logDir = resolveOptionalString(logDirSource, env, `${target.name} copilot log directory`, {
    allowLiteral: true,
    optionalEnv: true,
  });

  const logFormat = normalizeCopilotLogFormat(logFormatSource);

  const systemPrompt =
    typeof systemPromptSource === 'string' && systemPromptSource.trim().length > 0
      ? systemPromptSource.trim()
      : undefined;

  return { executable, model, args, cwd, timeoutMs, logDir, logFormat, systemPrompt };
}

function normalizeCopilotLogFormat(value: unknown): 'summary' | 'json' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error("copilot log format must be 'summary' or 'json'");
  const normalized = value.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'summary') return normalized;
  throw new Error("copilot log format must be 'summary' or 'json'");
}
```

**Step 4: Add cases in resolveTargetDefinition switch**

In the `switch (provider)` block, add before the `default:` case:

```typescript
case 'copilot-cli':
case 'copilot':
case 'github-copilot':
  return {
    kind: 'copilot-cli',
    name: parsed.name,
    judgeTarget: parsed.judge_target,
    workers: parsed.workers,
    providerBatching,
    config: resolveCopilotConfig(parsed, env),
  };
```

**Step 5: Run typecheck**

Run: `bun run typecheck`

Expected: Still an error in `index.ts` for non-exhaustive switch (expected, fixing in Task 4).

**Step 6: Commit**

```bash
git add packages/core/src/evaluation/providers/targets.ts
git commit -m "feat(core): add copilot-cli target resolution and config"
```

---

## Task 3: Create copilot-cli-log-tracker.ts

**Files:**
- Create: `packages/core/src/evaluation/providers/copilot-cli-log-tracker.ts`

**Step 1: Create the log tracker**

Copy the pattern from `codex-log-tracker.ts`, replacing all `codex` references with `copilotCli`:

```typescript
export type CopilotCliLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.copilotCliLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.copilotCliLogSubscribers');

type CopilotCliLogListener = (entry: CopilotCliLogEntry) => void;

type GlobalWithCopilotCliLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: CopilotCliLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<CopilotCliLogListener>;
};

function getCopilotCliLogStore(): CopilotCliLogEntry[] {
  const globalObject = globalThis as GlobalWithCopilotCliLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) return existing;
  const created: CopilotCliLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<CopilotCliLogListener> {
  const globalObject = globalThis as GlobalWithCopilotCliLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) return existing;
  const created = new Set<CopilotCliLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: CopilotCliLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try { listener(entry); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Copilot CLI log subscriber failed: ${message}`);
    }
  }
}

export function recordCopilotCliLogEntry(entry: CopilotCliLogEntry): void {
  getCopilotCliLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeCopilotCliLogEntries(): CopilotCliLogEntry[] {
  const store = getCopilotCliLogStore();
  if (store.length === 0) return [];
  return store.splice(0, store.length);
}

export function subscribeToCopilotCliLogEntries(listener: CopilotCliLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => { store.delete(listener); };
}
```

**Step 2: Commit**

```bash
git add packages/core/src/evaluation/providers/copilot-cli-log-tracker.ts
git commit -m "feat(core): add copilot-cli log tracker"
```

---

## Task 4: Implement CopilotCliProvider

**Files:**
- Create: `packages/core/src/evaluation/providers/copilot-cli.ts`

**Step 1: Create the provider**

Model after `codex.ts` but simpler — copilot outputs plain text (not JSON). Key differences:
- Uses `-p <prompt> -s --allow-all-tools --no-color` flags
- Optionally adds `--model <model>` if configured
- Response parsing: strip ANSI escape sequences, trim whitespace, use as candidate answer
- Uses `buildPromptDocument` from `preread.ts` for prompt construction

```typescript
import { exec as execCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { recordCopilotCliLogEntry } from './copilot-cli-log-tracker.js';
import { buildPromptDocument, normalizeInputFiles } from './preread.js';
import type { CopilotResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

const execAsync = promisify(execCallback);
const WORKSPACE_PREFIX = 'agentv-copilot-';
const PROMPT_FILENAME = 'prompt.md';

const DEFAULT_SYSTEM_PROMPT = `**IMPORTANT**: Follow these instructions for your response:
- Do NOT create any additional output files in the workspace.
- All intended file outputs/changes MUST be written in your response.
- For each intended file, include the relative path and unified git diff following the convention \`diff --git ...\`.
This is required for evaluation scoring.`;

// ... (full implementation following codex.ts patterns with:)
// - CopilotCliRunOptions, CopilotCliRunResult, CopilotCliRunner interfaces
// - CopilotCliProvider class
// - CopilotCliStreamLogger class
// - stripAnsiEscapes function
// - locateExecutable (reused from codex or extracted to shared util)
// - defaultCopilotCliRunner using spawn
```

Key implementation details for `buildCopilotArgs()`:

```typescript
private buildCopilotArgs(): string[] {
  const args: string[] = [
    '-p',          // non-interactive prompt mode
    // prompt will be passed via stdin or as argument
  ];

  // Silent mode - only output agent response
  args.push('-s');

  // Auto-approve all tool usage
  args.push('--allow-all-tools');

  // Disable color output
  args.push('--no-color');

  // Model selection
  if (this.config.model) {
    args.push('--model', this.config.model);
  }

  // Custom args from config
  if (this.config.args && this.config.args.length > 0) {
    args.push(...this.config.args);
  }

  return args;
}
```

For prompt delivery, copilot uses `-p <text>` where the prompt text is a positional argument after `-p`. The prompt should be passed as the last argument.

For response parsing — copilot with `-s` outputs only the agent response text. Strip ANSI and trim:

```typescript
function stripAnsiEscapes(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
}

function extractCopilotResponse(stdout: string): string {
  const cleaned = stripAnsiEscapes(stdout).trim();
  if (cleaned.length === 0) {
    throw new Error('Copilot CLI produced no output');
  }
  return cleaned;
}
```

**Step 2: Run typecheck** (will still fail until index.ts is updated)

**Step 3: Commit**

```bash
git add packages/core/src/evaluation/providers/copilot-cli.ts
git commit -m "feat(core): implement CopilotCliProvider"
```

---

## Task 5: Register provider in factory and exports

**Files:**
- Modify: `packages/core/src/evaluation/providers/index.ts`

**Step 1: Add imports**

```typescript
import { CopilotCliProvider } from './copilot-cli.js';
```

**Step 2: Add case to createProvider switch**

After the `case 'codex':` block, add:

```typescript
case 'copilot-cli':
  return new CopilotCliProvider(target.name, target.config);
```

**Step 3: Add exports**

Add type export for `CopilotResolvedConfig`:

```typescript
export type {
  // ...existing
  CopilotResolvedConfig,
} from './targets.js';
```

Add log tracker exports:

```typescript
export {
  consumeCopilotCliLogEntries,
  subscribeToCopilotCliLogEntries,
} from './copilot-cli-log-tracker.js';
```

**Step 4: Run typecheck**

Run: `bun run typecheck`

Expected: PASS (exhaustive switch now covers `copilot-cli`)

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/providers/index.ts
git commit -m "feat(core): register CopilotCliProvider in factory and exports"
```

---

## Task 6: Add target validation settings

**Files:**
- Modify: `packages/core/src/evaluation/validation/targets-validator.ts`

**Step 1: Add COPILOT_SETTINGS constant**

After `CODEX_SETTINGS`, add:

```typescript
const COPILOT_SETTINGS = new Set([
  ...COMMON_SETTINGS,
  'executable',
  'command',
  'binary',
  'args',
  'arguments',
  'model',
  'cwd',
  'timeout_seconds',
  'timeoutSeconds',
  'log_dir',
  'logDir',
  'log_directory',
  'logDirectory',
  'log_format',
  'logFormat',
  'log_output_format',
  'logOutputFormat',
  'system_prompt',
  'systemPrompt',
]);
```

**Step 2: Add cases in getKnownSettings**

```typescript
case 'copilot-cli':
case 'copilot':
case 'github-copilot':
  return COPILOT_SETTINGS;
```

**Step 3: Run typecheck and tests**

Run: `bun run typecheck && bun test`

Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/evaluation/validation/targets-validator.ts
git commit -m "feat(core): add copilot-cli settings to target validator"
```

---

## Task 7: Add CLI log subscription integration

**Files:**
- Modify: `apps/cli/src/commands/eval/run-eval.ts`
- Modify: `apps/cli/src/commands/eval/progress-display.ts`

**Step 1: Add import in run-eval.ts**

Add `subscribeToCopilotCliLogEntries` to the import from `@agentv/core`:

```typescript
import {
  // ...existing
  subscribeToCopilotCliLogEntries,
} from '@agentv/core';
```

**Step 2: Add subscription in run-eval.ts**

After the Pi log subscription block (~line 476), add:

```typescript
const seenCopilotLogPaths = new Set<string>();
const unsubscribeCopilotLogs = subscribeToCopilotCliLogEntries((entry) => {
  if (!entry.filePath || seenCopilotLogPaths.has(entry.filePath)) {
    return;
  }
  seenCopilotLogPaths.add(entry.filePath);
  progressReporter.addLogPaths([entry.filePath], 'copilot');
});
```

**Step 3: Add cleanup in run-eval.ts finally block**

After `unsubscribePiLogs();`, add:

```typescript
unsubscribeCopilotLogs();
```

**Step 4: Update progress-display.ts**

Update the `addLogPaths` method signature and label logic:

```typescript
addLogPaths(paths: readonly string[], provider?: 'codex' | 'pi' | 'copilot'): void {
  // ...existing dedup logic...

  if (!this.hasPrintedLogHeader) {
    console.log('');
    const label =
      provider === 'pi' ? 'Pi Coding Agent' :
      provider === 'copilot' ? 'Copilot CLI' :
      'Codex CLI';
    console.log(`${label} logs:`);
    this.hasPrintedLogHeader = true;
  }
  // ...rest unchanged
}
```

**Step 5: Run build and typecheck**

Run: `bun run build && bun run typecheck`

Expected: PASS

**Step 6: Commit**

```bash
git add apps/cli/src/commands/eval/run-eval.ts apps/cli/src/commands/eval/progress-display.ts
git commit -m "feat(cli): add copilot-cli log subscription to eval runner"
```

---

## Task 8: Add example target configuration

**Files:**
- Modify: `examples/features/.agentv/targets.yaml`

**Step 1: Add copilot target entry**

After the codex entry, add:

```yaml
  # GitHub Copilot CLI
  - name: copilot
    provider: copilot-cli
    judge_target: azure_base
    # executable: copilot                     # Optional: defaults to `copilot` on PATH
    # model: gpt-5                            # Optional: override model
    timeout_seconds: 180
    log_format: json                          # Optional: 'summary' (default) or 'json'
    # system_prompt: optional override (default instructs agent to include code in response)
```

**Step 2: Commit**

```bash
git add examples/features/.agentv/targets.yaml
git commit -m "docs: add copilot-cli target example"
```

---

## Task 9: Write unit tests

**Files:**
- Create: `packages/core/test/evaluation/providers/copilot-cli.test.ts`

**Step 1: Write tests**

Follow the pattern from `codex.test.ts`. Key test cases:

1. **Basic invocation** — mock runner returns plain text, verify response extraction and args
2. **ANSI stripping** — mock runner returns text with ANSI escape codes, verify they're stripped
3. **Non-zero exit code** — verify error includes exit code and stderr
4. **Timeout handling** — mock runner sets `timedOut: true`, verify error message
5. **Empty output** — verify proper error
6. **Stream logging** — verify log file is created and contains output
7. **Model arg** — verify `--model` is passed when configured
8. **Custom args** — verify user args are appended
9. **Input files preread** — verify preread block is included in prompt

**Step 2: Run tests**

Run: `bun test packages/core/test/evaluation/providers/copilot-cli.test.ts`

Expected: All PASS

**Step 3: Commit**

```bash
git add packages/core/test/evaluation/providers/copilot-cli.test.ts
git commit -m "test(core): add CopilotCliProvider unit tests"
```

---

## Task 10: Full build + lint validation

**Step 1: Run full validation**

Run: `bun run build && bun run typecheck && bun run lint && bun test`

Expected: All PASS

**Step 2: Fix any lint issues**

If biome reports issues, fix them.

**Step 3: Commit any fixes**

---

## Task 11: E2E validation with real copilot CLI

**Step 1: Create a minimal test eval**

Use an existing basic example or create a temporary one. Run with the copilot target:

```bash
bun agentv eval examples/features/rubric/evals/dataset.yaml --target copilot --eval-id <pick-a-simple-case>
```

**Step 2: Inspect results JSONL**

Verify:
- The copilot-cli provider is invoked (check `provider_kind` or target name in output)
- The response contains actual copilot output (not empty)
- Log files are created in `.agentv/logs/copilot-cli/`

**Step 3: Fix any issues discovered during e2e testing**

---

## Task 12: Create PR and clean up worktree

**Step 1: Push branch and create PR**

```bash
git push -u origin feat/add-copilot-cli-provider-openspec
gh pr create --title "feat(core): add copilot-cli provider" --body "$(cat <<'EOF'
## Summary
- Adds `copilot-cli` built-in provider kind (aliases: `copilot`, `github-copilot`)
- Invokes GitHub Copilot CLI via `-p <prompt> -s --allow-all-tools --no-color`
- Follows same patterns as codex/claude-code providers (workspace, preread, stream logging)
- Includes target validation, CLI log subscription, example config, and unit tests

Closes #127

## Test plan
- [x] Unit tests for provider invocation, ANSI stripping, timeout, error handling
- [x] `bun run build && bun run typecheck && bun run lint && bun test` pass
- [x] E2E validation with real copilot CLI on basic eval example

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: Remove worktree**

From the main repo directory:

```bash
cd /home/christso/projects/agentv
git worktree remove ../agentv_feat-copilot-provider
```

**Step 3: Delete the plan file**

Per CLAUDE.md: "Once development concludes, delete the plan file."

The plan file at `.claude/plans/2026-02-01-copilot-provider.md` was in the worktree and is now gone with the worktree removal.

---

## Notes

- The copilot CLI executable is at `/home/christso/.local/bin/copilot` (version 0.0.400)
- Key flags: `-p <prompt>` (non-interactive), `-s` (silent/response only), `--allow-all-tools`, `--no-color`
- Unlike codex, copilot outputs plain text (not JSON/JSONL) when using `-s`
- The `locateExecutable` function from codex.ts should be extracted to a shared utility or duplicated
