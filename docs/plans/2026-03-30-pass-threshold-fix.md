# Fix Studio Pass/Fail Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Studio dashboard to use the core engine's 0.8 pass threshold instead of requiring a perfect 1.0 score, and allow users to override the threshold via a `config.yaml` in the results/runs directory.

**Architecture:** The server reads an optional `config.yaml` from the runs directory for a `pass_threshold` override (default: 0.8 from core). It exposes this via `/api/config`. The frontend fetches the config and uses the threshold for all pass/fail UI decisions. All 12 hardcoded `score >= 1` checks across server and client are replaced with threshold-based checks.

**Tech Stack:** TypeScript, Hono (server), React + TanStack Query (client), YAML parsing (already a dependency)

---

### Task 1: Add `/api/config` endpoint with `config.yaml` support

**Files:**
- Modify: `apps/cli/src/commands/results/serve.ts:150-160` (add config endpoint near top of route definitions)
- Modify: `apps/cli/src/commands/results/serve.ts:790-830` (load config at startup)

- [ ] **Step 1: Write test for config loading**

Create `apps/cli/src/commands/results/__tests__/studio-config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { loadStudioConfig, type StudioConfig } from '../studio-config.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadStudioConfig', () => {
  it('returns defaults when no config.yaml exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentv-test-'));
    try {
      const config = loadStudioConfig(dir);
      expect(config.pass_threshold).toBe(0.8);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('reads pass_threshold from config.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentv-test-'));
    try {
      writeFileSync(join(dir, 'config.yaml'), 'pass_threshold: 0.9\n');
      const config = loadStudioConfig(dir);
      expect(config.pass_threshold).toBe(0.9);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('clamps pass_threshold to [0, 1]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentv-test-'));
    try {
      writeFileSync(join(dir, 'config.yaml'), 'pass_threshold: 1.5\n');
      const config = loadStudioConfig(dir);
      expect(config.pass_threshold).toBe(1.0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/cli/src/commands/results/__tests__/studio-config.test.ts`
Expected: FAIL — module `../studio-config.js` not found

- [ ] **Step 3: Create `studio-config.ts` module**

Create `apps/cli/src/commands/results/studio-config.ts`:

```typescript
/**
 * Studio configuration loader.
 *
 * Reads an optional `config.yaml` from the results/runs directory to override
 * Studio defaults. The primary use case is customizing the pass/fail threshold.
 *
 * To configure: create `config.yaml` in your `.agentv/results/runs/` directory:
 *
 * ```yaml
 * pass_threshold: 0.9
 * ```
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { PASS_THRESHOLD } from '@agentv/core';

export interface StudioConfig {
  pass_threshold: number;
}

const STUDIO_CONFIG_FILENAME = 'config.yaml';

export function loadStudioConfig(runsDir: string): StudioConfig {
  const configPath = join(runsDir, STUDIO_CONFIG_FILENAME);
  const defaults: StudioConfig = { pass_threshold: PASS_THRESHOLD };

  if (!existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = parseYaml(raw) as Record<string, unknown>;

    let passThreshold = defaults.pass_threshold;
    if (typeof parsed?.pass_threshold === 'number') {
      passThreshold = Math.max(0, Math.min(1, parsed.pass_threshold));
    }

    return { pass_threshold: passThreshold };
  } catch {
    return defaults;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/cli/src/commands/results/__tests__/studio-config.test.ts`
Expected: PASS

- [ ] **Step 5: Wire config into serve.ts and add `/api/config` endpoint**

In `apps/cli/src/commands/results/serve.ts`:

1. Import `loadStudioConfig` at the top
2. Load config at server startup (near where `searchDir` is established)
3. Add `GET /api/config` endpoint that returns the config
4. Use `config.pass_threshold` in all 5 server-side `score >= 1` checks (lines 281, 321, 357, 604, 655)

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/results/studio-config.ts apps/cli/src/commands/results/__tests__/studio-config.test.ts apps/cli/src/commands/results/serve.ts
git commit -m "fix(studio): add config.yaml support with pass_threshold override

Closes #862"
```

---

### Task 2: Fix server-side pass/fail threshold in `trace/utils.ts`

**Files:**
- Modify: `apps/cli/src/commands/trace/utils.ts:599` (listResultFiles pass count)

- [ ] **Step 1: Replace hardcoded threshold**

Change line 599 from:
```typescript
const passCount = results.filter((r) => r.score >= 1.0).length;
```
to:
```typescript
const passCount = results.filter((r) => r.score >= PASS_THRESHOLD).length;
```

Import `PASS_THRESHOLD` from `@agentv/core`.

Note: `listResultFiles` doesn't have access to the Studio config (it's a utility function). Using the core default here is correct — the Studio config override only applies to the Studio server and UI.

- [ ] **Step 2: Run tests**

Run: `bun test apps/cli/src/commands/trace/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/commands/trace/utils.ts
git commit -m "fix(studio): use PASS_THRESHOLD in listResultFiles"
```

---

### Task 3: Add Studio frontend config hook and threshold constant

**Files:**
- Modify: `apps/studio/src/lib/api.ts` (add `useStudioConfig` hook)
- Modify: `apps/studio/src/lib/types.ts` (add `StudioConfigResponse` type)

- [ ] **Step 1: Add type to `types.ts`**

Add to `apps/studio/src/lib/types.ts`:

```typescript
export interface StudioConfigResponse {
  pass_threshold: number;
}
```

- [ ] **Step 2: Add `useStudioConfig` hook to `api.ts`**

Add a new query hook:

```typescript
export function useStudioConfig() {
  return useQuery<StudioConfigResponse>({
    ...queryOpts('/api/config'),
    staleTime: 60_000, // config rarely changes, refresh every 60s
  });
}
```

- [ ] **Step 3: Add helper function for pass/fail check**

Add to `apps/studio/src/lib/api.ts` (or a new small utility):

```typescript
/** Default pass threshold matching @agentv/core PASS_THRESHOLD */
export const DEFAULT_PASS_THRESHOLD = 0.8;

export function isPassing(score: number, passThreshold: number = DEFAULT_PASS_THRESHOLD): boolean {
  return score >= passThreshold;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/lib/api.ts apps/studio/src/lib/types.ts
git commit -m "fix(studio): add useStudioConfig hook and isPassing helper"
```

---

### Task 4: Fix RunDetail.tsx pass/fail logic

**Files:**
- Modify: `apps/studio/src/components/RunDetail.tsx:53,87`

- [ ] **Step 1: Update `buildCategoryGroups` to accept threshold**

Change `buildCategoryGroups` signature to accept a `passThreshold` parameter. Replace `r.score >= 1` with `r.score >= passThreshold` on line 53.

- [ ] **Step 2: Update `RunDetail` component**

Add `useStudioConfig()` hook. Replace `r.score >= 1` on line 87 with `isPassing(r.score, config?.pass_threshold)`. Pass threshold to `buildCategoryGroups`.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/components/RunDetail.tsx
git commit -m "fix(studio): use pass threshold in RunDetail"
```

---

### Task 5: Fix EvalDetail.tsx failure reason logic

**Files:**
- Modify: `apps/studio/src/components/EvalDetail.tsx:124,141`

- [ ] **Step 1: Update `StepsTab` to use threshold**

Add `useStudioConfig()` hook to `StepsTab`. Replace:
- Line 124: `result.score < 1` → `!isPassing(result.score, config?.pass_threshold)`
- Line 141: `s.score < 1 && s.details` → `!isPassing(s.score, config?.pass_threshold) && s.details`

- [ ] **Step 2: Commit**

```bash
git add apps/studio/src/components/EvalDetail.tsx
git commit -m "fix(studio): use pass threshold in EvalDetail failure reasons"
```

---

### Task 6: Fix Sidebar.tsx and dataset page

**Files:**
- Modify: `apps/studio/src/components/Sidebar.tsx:140,198`
- Modify: `apps/studio/src/routes/runs/$runId_.dataset.$dataset.tsx:46`

- [ ] **Step 1: Update EvalSidebar and DatasetSidebar**

Add `useStudioConfig()` hook to each. Replace `result.score >= 1` with `isPassing(result.score, config?.pass_threshold)`.

- [ ] **Step 2: Update dataset page**

Add `useStudioConfig()` hook. Replace `r.score >= 1` on line 46 with `isPassing(r.score, config?.pass_threshold)`.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/components/Sidebar.tsx apps/studio/src/routes/runs/\$runId_.dataset.\$dataset.tsx
git commit -m "fix(studio): use pass threshold in Sidebar and dataset page"
```

---

### Task 7: Build, typecheck, lint, test

- [ ] **Step 1: Run full build and checks**

```bash
bun run build
bun run typecheck
bun run lint
bun run test
```

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit if needed and push**

```bash
git push -u origin fix/862-pass-threshold
gh pr create --title "fix(studio): use 0.8 pass threshold instead of 1.0" --body "..."
```
