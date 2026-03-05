# Workspace Repo Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class declarative repo lifecycle to eval.yaml — clone, checkout, reset, persistent cache — so users don't need custom scripts for common repo-backed eval workflows.

**Architecture:** New `RepoManager` class in `packages/core/src/evaluation/workspace/repo-manager.ts` handles all git operations (cache, clone, checkout, reset). Schema extended with `repos`, `reset`, `isolation` fields. Orchestrator calls RepoManager between template copy and hooks. Default system prompts removed from all providers.

**Tech Stack:** TypeScript, Zod (schema), Node.js child_process (git commands), Vitest (tests)

---

### Task 1: Add Zod schemas for repo lifecycle

**Files:**
- Modify: `packages/core/src/evaluation/validation/eval-file.schema.ts:242-259`

**Step 1: Write the failing test**

Create test in `packages/core/test/evaluation/repo-schema-validation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

// We'll import the schema after creating it
// For now, test that the eval file schema accepts repos/reset/isolation
import { EvalFileSchema } from '../../src/evaluation/validation/eval-file.schema.js';

describe('repo lifecycle schema validation', () => {
  const baseEval = {
    description: 'test',
    tests: [{ id: 'test-1', input: [{ role: 'user', content: [{ type: 'text', value: 'hello' }] }] }],
  };

  it('accepts workspace with repos (git source)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ref: 'main' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with repos (local source)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-b',
            source: { type: 'local', path: '/opt/mirrors/repo-b' },
            checkout: { ref: '4a1b2c3d' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with full clone options', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ref: 'main', resolve: 'remote', ancestor: 1 },
            clone: { depth: 2, filter: 'blob:none', sparse: ['src/**', 'package.json'] },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with reset config', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
        reset: { strategy: 'hard', after_each: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts workspace with isolation field', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        isolation: 'per_test',
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid source type', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'svn', url: 'https://example.com' },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid reset strategy', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        reset: { strategy: 'invalid' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative ancestor', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            checkout: { ancestor: -1 },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clone depth of 0', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
            clone: { depth: 0 },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('preserves existing workspace fields (template, hooks)', () => {
    const result = EvalFileSchema.safeParse({
      ...baseEval,
      workspace: {
        template: './fixtures',
        before_all: { command: ['bash', 'setup.sh'] },
        repos: [
          {
            path: './repo-a',
            source: { type: 'git', url: 'https://github.com/org/repo.git' },
          },
        ],
        reset: { strategy: 'hard', after_each: true },
      },
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/repo-schema-validation.test.ts`
Expected: FAIL — schema doesn't accept `repos`, `reset`, `isolation` fields yet

**Step 3: Write minimal implementation**

In `packages/core/src/evaluation/validation/eval-file.schema.ts`, add before the existing `WorkspaceSchema` (around line 253):

```typescript
// ---------------------------------------------------------------------------
// Repo lifecycle
// ---------------------------------------------------------------------------

const RepoSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git'), url: z.string().url() }),
  z.object({ type: z.literal('local'), path: z.string() }),
]);

const RepoCheckoutSchema = z.object({
  ref: z.string().optional(),
  resolve: z.enum(['remote', 'local']).optional(),
  ancestor: z.number().int().min(0).optional(),
});

const RepoCloneSchema = z.object({
  depth: z.number().int().min(1).optional(),
  filter: z.string().optional(),
  sparse: z.array(z.string()).optional(),
});

const RepoSchema = z.object({
  path: z.string(),
  source: RepoSourceSchema,
  checkout: RepoCheckoutSchema.optional(),
  clone: RepoCloneSchema.optional(),
});

const ResetSchema = z.object({
  strategy: z.enum(['none', 'hard', 'recreate']).optional(),
  after_each: z.boolean().optional(),
});
```

Then update `WorkspaceSchema` to include the new fields:

```typescript
const WorkspaceSchema = z.object({
  template: z.string().optional(),
  isolation: z.enum(['shared', 'per_test']).optional(),
  repos: z.array(RepoSchema).optional(),
  reset: ResetSchema.optional(),
  before_all: WorkspaceScriptSchema.optional(),
  after_all: WorkspaceScriptSchema.optional(),
  before_each: WorkspaceScriptSchema.optional(),
  after_each: WorkspaceScriptSchema.optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/repo-schema-validation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/validation/eval-file.schema.ts packages/core/test/evaluation/repo-schema-validation.test.ts
git commit -m "feat(core): add Zod schemas for workspace repo lifecycle (#410)"
```

---

### Task 2: Add TypeScript types for repo lifecycle

**Files:**
- Modify: `packages/core/src/evaluation/types.ts:221-233`

**Step 1: Write the failing test**

No separate test needed — types are validated via TypeScript compilation. The next tasks will import and use these types.

**Step 2: Add types to `types.ts`**

After the existing `WorkspaceScriptConfig` type (line 208) and before `WorkspaceConfig` (line 221), add:

```typescript
export type RepoSource =
  | { readonly type: 'git'; readonly url: string }
  | { readonly type: 'local'; readonly path: string };

export type RepoCheckout = {
  readonly ref?: string;
  readonly resolve?: 'remote' | 'local';
  readonly ancestor?: number;
};

export type RepoClone = {
  readonly depth?: number;
  readonly filter?: string;
  readonly sparse?: readonly string[];
};

export type RepoConfig = {
  readonly path: string;
  readonly source: RepoSource;
  readonly checkout?: RepoCheckout;
  readonly clone?: RepoClone;
};

export type ResetConfig = {
  readonly strategy?: 'none' | 'hard' | 'recreate';
  readonly after_each?: boolean;
};
```

Then update `WorkspaceConfig` to include the new fields:

```typescript
export type WorkspaceConfig = {
  readonly template?: string;
  readonly isolation?: 'shared' | 'per_test';
  readonly repos?: readonly RepoConfig[];
  readonly reset?: ResetConfig;
  readonly before_all?: WorkspaceScriptConfig;
  readonly after_all?: WorkspaceScriptConfig;
  readonly before_each?: WorkspaceScriptConfig;
  readonly after_each?: WorkspaceScriptConfig;
};
```

**Step 3: Verify typecheck passes**

Run: `cd /home/christso/projects/agentv && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/evaluation/types.ts
git commit -m "feat(core): add TypeScript types for repo lifecycle (#410)"
```

---

### Task 3: Parse repo config in yaml-parser

**Files:**
- Modify: `packages/core/src/evaluation/yaml-parser.ts:512-556`
- Test: `packages/core/test/evaluation/workspace-config-parsing.test.ts`

**Step 1: Write the failing test**

Add tests to the existing `packages/core/test/evaluation/workspace-config-parsing.test.ts`:

```typescript
// Add to the existing describe block:

it('parses workspace repos from YAML', () => {
  const yaml = `
description: test
workspace:
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo.git
      checkout:
        ref: main
        resolve: remote
        ancestor: 1
      clone:
        depth: 2
        filter: blob:none
        sparse:
          - src/**
tests:
  - id: test-1
    input:
      - role: user
        content:
          - type: text
            value: hello
`;
  const result = parseEvalFile(yaml, '/tmp/eval.yaml');
  const workspace = result.tests[0].workspace;
  expect(workspace?.repos).toHaveLength(1);
  expect(workspace?.repos?.[0].path).toBe('./repo-a');
  expect(workspace?.repos?.[0].source).toEqual({ type: 'git', url: 'https://github.com/org/repo.git' });
  expect(workspace?.repos?.[0].checkout?.ref).toBe('main');
  expect(workspace?.repos?.[0].checkout?.resolve).toBe('remote');
  expect(workspace?.repos?.[0].checkout?.ancestor).toBe(1);
  expect(workspace?.repos?.[0].clone?.depth).toBe(2);
  expect(workspace?.repos?.[0].clone?.filter).toBe('blob:none');
  expect(workspace?.repos?.[0].clone?.sparse).toEqual(['src/**']);
});

it('parses workspace reset config', () => {
  const yaml = `
description: test
workspace:
  reset:
    strategy: hard
    after_each: true
tests:
  - id: test-1
    input:
      - role: user
        content:
          - type: text
            value: hello
`;
  const result = parseEvalFile(yaml, '/tmp/eval.yaml');
  expect(result.tests[0].workspace?.reset?.strategy).toBe('hard');
  expect(result.tests[0].workspace?.reset?.after_each).toBe(true);
});

it('parses workspace isolation field', () => {
  const yaml = `
description: test
workspace:
  isolation: per_test
  repos:
    - path: ./repo-a
      source:
        type: git
        url: https://github.com/org/repo.git
tests:
  - id: test-1
    input:
      - role: user
        content:
          - type: text
            value: hello
`;
  const result = parseEvalFile(yaml, '/tmp/eval.yaml');
  expect(result.tests[0].workspace?.isolation).toBe('per_test');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/workspace-config-parsing.test.ts`
Expected: FAIL — parser doesn't extract repos/reset/isolation yet

**Step 3: Update `parseWorkspaceConfig` in yaml-parser.ts**

In `parseWorkspaceConfig()` (line 512), add parsing for the new fields. After the existing hook parsing and before the return statement:

```typescript
function parseWorkspaceConfig(raw: unknown, evalFileDir: string): WorkspaceConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  let template = typeof obj.template === 'string' ? obj.template : undefined;
  if (template && !path.isAbsolute(template)) {
    template = path.resolve(evalFileDir, template);
  }

  const isolation = obj.isolation === 'shared' || obj.isolation === 'per_test'
    ? obj.isolation
    : undefined;

  const repos = Array.isArray(obj.repos)
    ? (obj.repos as Record<string, unknown>[]).map(parseRepoConfig).filter(Boolean) as RepoConfig[]
    : undefined;

  const reset = parseResetConfig(obj.reset);

  const beforeAll = parseWorkspaceScriptConfig(obj.before_all, evalFileDir);
  const afterAll = parseWorkspaceScriptConfig(obj.after_all, evalFileDir);
  const beforeEach = parseWorkspaceScriptConfig(obj.before_each, evalFileDir);
  const afterEach = parseWorkspaceScriptConfig(obj.after_each, evalFileDir);

  if (!template && !isolation && !repos && !reset && !beforeAll && !afterAll && !beforeEach && !afterEach)
    return undefined;

  return {
    ...(template !== undefined && { template }),
    ...(isolation !== undefined && { isolation }),
    ...(repos !== undefined && { repos }),
    ...(reset !== undefined && { reset }),
    ...(beforeAll !== undefined && { before_all: beforeAll }),
    ...(afterAll !== undefined && { after_all: afterAll }),
    ...(beforeEach !== undefined && { before_each: beforeEach }),
    ...(afterEach !== undefined && { after_each: afterEach }),
  };
}
```

Add helper functions before `parseWorkspaceConfig`:

```typescript
function parseRepoSource(raw: unknown): RepoSource | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'git' && typeof obj.url === 'string') {
    return { type: 'git', url: obj.url };
  }
  if (obj.type === 'local' && typeof obj.path === 'string') {
    return { type: 'local', path: obj.path };
  }
  return undefined;
}

function parseRepoCheckout(raw: unknown): RepoCheckout | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const ref = typeof obj.ref === 'string' ? obj.ref : undefined;
  const resolve = obj.resolve === 'remote' || obj.resolve === 'local' ? obj.resolve : undefined;
  const ancestor = typeof obj.ancestor === 'number' ? obj.ancestor : undefined;
  if (!ref && !resolve && ancestor === undefined) return undefined;
  return {
    ...(ref !== undefined && { ref }),
    ...(resolve !== undefined && { resolve }),
    ...(ancestor !== undefined && { ancestor }),
  };
}

function parseRepoClone(raw: unknown): RepoClone | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const depth = typeof obj.depth === 'number' ? obj.depth : undefined;
  const filter = typeof obj.filter === 'string' ? obj.filter : undefined;
  const sparse = Array.isArray(obj.sparse) ? obj.sparse.filter((s): s is string => typeof s === 'string') : undefined;
  if (depth === undefined && !filter && !sparse) return undefined;
  return {
    ...(depth !== undefined && { depth }),
    ...(filter !== undefined && { filter }),
    ...(sparse !== undefined && { sparse }),
  };
}

function parseRepoConfig(raw: unknown): RepoConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const repoPath = typeof obj.path === 'string' ? obj.path : undefined;
  const source = parseRepoSource(obj.source);
  if (!repoPath || !source) return undefined;
  const checkout = parseRepoCheckout(obj.checkout);
  const clone = parseRepoClone(obj.clone);
  return {
    path: repoPath,
    source,
    ...(checkout !== undefined && { checkout }),
    ...(clone !== undefined && { clone }),
  };
}

function parseResetConfig(raw: unknown): ResetConfig | undefined {
  if (!isJsonObject(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const strategy = obj.strategy === 'none' || obj.strategy === 'hard' || obj.strategy === 'recreate'
    ? obj.strategy
    : undefined;
  const afterEach = typeof obj.after_each === 'boolean' ? obj.after_each : undefined;
  if (!strategy && afterEach === undefined) return undefined;
  return {
    ...(strategy !== undefined && { strategy }),
    ...(afterEach !== undefined && { after_each: afterEach }),
  };
}
```

Also update `mergeWorkspaceConfigs` to handle the new fields:

```typescript
function mergeWorkspaceConfigs(
  suiteLevel: WorkspaceConfig | undefined,
  caseLevel: WorkspaceConfig | undefined,
): WorkspaceConfig | undefined {
  if (!suiteLevel && !caseLevel) return undefined;
  if (!suiteLevel) return caseLevel;
  if (!caseLevel) return suiteLevel;

  return {
    template: caseLevel.template ?? suiteLevel.template,
    isolation: caseLevel.isolation ?? suiteLevel.isolation,
    repos: caseLevel.repos ?? suiteLevel.repos,
    reset: caseLevel.reset ?? suiteLevel.reset,
    before_all: caseLevel.before_all ?? suiteLevel.before_all,
    after_all: caseLevel.after_all ?? suiteLevel.after_all,
    before_each: caseLevel.before_each ?? suiteLevel.before_each,
    after_each: caseLevel.after_each ?? suiteLevel.after_each,
  };
}
```

Add the necessary imports at the top of `yaml-parser.ts`:

```typescript
import type { RepoConfig, RepoSource, RepoCheckout, RepoClone, ResetConfig } from './types.js';
```

**Step 4: Run test to verify it passes**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/workspace-config-parsing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/yaml-parser.ts packages/core/test/evaluation/workspace-config-parsing.test.ts
git commit -m "feat(core): parse repo lifecycle config from eval YAML (#410)"
```

---

### Task 4: Implement RepoManager — git helpers and cache

**Files:**
- Create: `packages/core/src/evaluation/workspace/repo-manager.ts`
- Create: `packages/core/test/evaluation/workspace/repo-manager.test.ts`

**Step 1: Write the failing tests**

```typescript
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RepoManager } from '../../../src/evaluation/workspace/repo-manager.js';

function createTestRepo(dir: string, files?: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  const defaultFiles = { 'README.md': '# Test', ...files };
  for (const [name, content] of Object.entries(defaultFiles)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  execSync('git add -A && git commit -m "initial"', { cwd: dir, stdio: 'ignore' });
  return execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
}

describe('RepoManager', () => {
  let tmpDir: string;
  let cacheDir: string;
  let workspaceDir: string;
  let manager: RepoManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'repo-manager-test-'));
    cacheDir = path.join(tmpDir, 'cache');
    workspaceDir = path.join(tmpDir, 'workspace');
    mkdirSync(workspaceDir, { recursive: true });
    manager = new RepoManager(cacheDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('ensureCache', () => {
    it('creates bare mirror from local source', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);

      const cachePath = await manager.ensureCache({ type: 'local', path: repoDir });

      expect(existsSync(cachePath)).toBe(true);
      // Verify it's a bare repo
      const isBare = execSync('git rev-parse --is-bare-repository', { cwd: cachePath }).toString().trim();
      expect(isBare).toBe('true');
    });

    it('reuses existing cache on second call', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);

      const first = await manager.ensureCache({ type: 'local', path: repoDir });
      const second = await manager.ensureCache({ type: 'local', path: repoDir });
      expect(first).toBe(second);
    });
  });

  describe('materialize', () => {
    it('clones repo into workspace at specified path', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'hello.txt': 'hello world' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      expect(existsSync(path.join(targetDir, 'hello.txt'))).toBe(true);
    });

    it('checks out specified ref', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      // Create a second commit
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, stdio: 'ignore' });
      const secondSha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
      // Create a third commit
      writeFileSync(path.join(repoDir, 'third.txt'), 'third');
      execSync('git add -A && git commit -m "third"', { cwd: repoDir, stdio: 'ignore' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: secondSha },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = execSync('git rev-parse HEAD', { cwd: targetDir }).toString().trim();
      expect(headSha).toBe(secondSha);
      expect(existsSync(path.join(targetDir, 'second.txt'))).toBe(true);
      expect(existsSync(path.join(targetDir, 'third.txt'))).toBe(false);
    });

    it('walks ancestor commits', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      const firstSha = createTestRepo(repoDir);
      writeFileSync(path.join(repoDir, 'second.txt'), 'second');
      execSync('git add -A && git commit -m "second"', { cwd: repoDir, stdio: 'ignore' });

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          checkout: { ref: 'HEAD', ancestor: 1 },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const headSha = execSync('git rev-parse HEAD', { cwd: targetDir }).toString().trim();
      expect(headSha).toBe(firstSha);
    });

    it('supports shallow clone with depth', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      for (let i = 0; i < 5; i++) {
        writeFileSync(path.join(repoDir, `file-${i}.txt`), `content-${i}`);
        execSync(`git add -A && git commit -m "commit-${i}"`, { cwd: repoDir, stdio: 'ignore' });
      }

      await manager.materialize(
        {
          path: './my-repo',
          source: { type: 'local', path: repoDir },
          clone: { depth: 2 },
        },
        workspaceDir,
      );

      const targetDir = path.join(workspaceDir, 'my-repo');
      const logCount = execSync('git rev-list --count HEAD', { cwd: targetDir }).toString().trim();
      expect(Number(logCount)).toBe(2);
    });
  });

  describe('materializeAll', () => {
    it('materializes multiple repos', async () => {
      const repoA = path.join(tmpDir, 'repo-a');
      const repoB = path.join(tmpDir, 'repo-b');
      createTestRepo(repoA, { 'a.txt': 'a' });
      createTestRepo(repoB, { 'b.txt': 'b' });

      await manager.materializeAll(
        [
          { path: './repo-a', source: { type: 'local', path: repoA } },
          { path: './repo-b', source: { type: 'local', path: repoB } },
        ],
        workspaceDir,
      );

      expect(existsSync(path.join(workspaceDir, 'repo-a', 'a.txt'))).toBe(true);
      expect(existsSync(path.join(workspaceDir, 'repo-b', 'b.txt'))).toBe(true);
    });
  });

  describe('reset', () => {
    it('hard reset restores repo to checkout state', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir, { 'original.txt': 'original' });
      const repo = { path: './my-repo', source: { type: 'local' as const, path: repoDir } };

      await manager.materialize(repo, workspaceDir);

      // Simulate agent modifications
      const targetDir = path.join(workspaceDir, 'my-repo');
      writeFileSync(path.join(targetDir, 'agent-created.txt'), 'agent output');
      writeFileSync(path.join(targetDir, 'original.txt'), 'modified by agent');

      await manager.reset([repo], workspaceDir, 'hard');

      expect(existsSync(path.join(targetDir, 'agent-created.txt'))).toBe(false);
      const content = require('node:fs').readFileSync(path.join(targetDir, 'original.txt'), 'utf-8');
      expect(content).toBe('original');
    });
  });

  describe('cleanCache', () => {
    it('removes the entire cache directory', async () => {
      const repoDir = path.join(tmpDir, 'source-repo');
      createTestRepo(repoDir);
      await manager.ensureCache({ type: 'local', path: repoDir });
      expect(existsSync(cacheDir)).toBe(true);

      await manager.cleanCache();
      expect(existsSync(cacheDir)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/workspace/repo-manager.test.ts`
Expected: FAIL — module doesn't exist yet

**Step 3: Implement RepoManager**

Create `packages/core/src/evaluation/workspace/repo-manager.ts`:

```typescript
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RepoConfig, RepoSource } from '../types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.agentv', 'git-cache');
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const LOCK_TIMEOUT_MS = 60_000; // 1 minute

/** Environment vars to force non-interactive git */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
};

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\.git$/, '');
}

function cacheKey(source: RepoSource): string {
  const raw = source.type === 'git' ? source.url : source.path;
  return createHash('sha256').update(normalizeUrl(raw)).digest('hex');
}

function getSourceUrl(source: RepoSource): string {
  return source.type === 'git' ? source.url : source.path;
}

async function git(args: string[], opts?: { cwd?: string; timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: opts?.cwd,
    timeout: opts?.timeout ?? DEFAULT_TIMEOUT_MS,
    env: GIT_ENV,
    maxBuffer: 50 * 1024 * 1024, // 50MB
  });
  return stdout.trim();
}

async function acquireLock(lockPath: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Timed out waiting for lock: ${lockPath}`);
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // Lock file may already be removed
  }
}

export class RepoManager {
  private readonly cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
  }

  /**
   * Ensure a bare mirror cache exists for the given source.
   * Creates on first access, fetches updates on subsequent calls.
   * Returns the absolute path to the cache directory.
   */
  async ensureCache(source: RepoSource): Promise<string> {
    const key = cacheKey(source);
    const cachePath = path.join(this.cacheDir, key);
    const lockPath = `${cachePath}.lock`;

    await mkdir(this.cacheDir, { recursive: true });
    await acquireLock(lockPath);

    try {
      if (existsSync(path.join(cachePath, 'HEAD'))) {
        // Cache exists — fetch updates
        await git(['fetch', '--prune'], { cwd: cachePath });
      } else {
        // Clone as bare mirror
        await git(['clone', '--mirror', '--bare', getSourceUrl(source), cachePath]);
      }
    } finally {
      await releaseLock(lockPath);
    }

    return cachePath;
  }

  /**
   * Clone a repo from cache into the workspace at the configured path.
   * Handles checkout, ref resolution, ancestor walking, shallow clone, sparse checkout.
   */
  async materialize(repo: RepoConfig, workspacePath: string): Promise<void> {
    const targetDir = path.join(workspacePath, repo.path);
    const cachePath = await this.ensureCache(repo.source);
    const url = getSourceUrl(repo.source);

    // Build clone args
    const cloneArgs = ['clone'];
    cloneArgs.push('--reference', cachePath);

    if (repo.clone?.depth) {
      cloneArgs.push('--depth', String(repo.clone.depth));
    }
    if (repo.clone?.filter) {
      cloneArgs.push('--filter', repo.clone.filter);
    }

    // Clone with no checkout so we can control the checkout step
    cloneArgs.push('--no-checkout');
    cloneArgs.push(url, targetDir);

    await git(cloneArgs);

    // Sparse checkout setup (before actual checkout)
    if (repo.clone?.sparse?.length) {
      await git(['sparse-checkout', 'init', '--cone'], { cwd: targetDir });
      await git(['sparse-checkout', 'set', ...repo.clone.sparse], { cwd: targetDir });
    }

    // Resolve ref
    const ref = repo.checkout?.ref ?? 'HEAD';
    const resolve = repo.checkout?.resolve ?? 'remote';

    let resolvedSha: string;
    if (resolve === 'remote' && repo.source.type === 'git') {
      // Resolve via ls-remote for remote refs
      try {
        const lsOutput = await git(['ls-remote', url, ref]);
        const match = lsOutput.split('\t')[0];
        if (!match) {
          throw new Error(`Ref '${ref}' not found on remote ${url}`);
        }
        resolvedSha = match;
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) throw err;
        // Might be a SHA already — try direct checkout
        resolvedSha = ref;
      }
    } else {
      // Resolve locally from the cloned repo
      resolvedSha = ref;
    }

    // Checkout
    await git(['checkout', resolvedSha], { cwd: targetDir });

    // Walk ancestors if requested
    const ancestor = repo.checkout?.ancestor ?? 0;
    if (ancestor > 0) {
      try {
        const ancestorSha = await git(['rev-parse', `HEAD~${ancestor}`], { cwd: targetDir });
        await git(['checkout', ancestorSha], { cwd: targetDir });
      } catch {
        // Try to deepen if shallow
        if (repo.clone?.depth) {
          await git(['fetch', '--deepen', String(ancestor)], { cwd: targetDir });
          const ancestorSha = await git(['rev-parse', `HEAD~${ancestor}`], { cwd: targetDir });
          await git(['checkout', ancestorSha], { cwd: targetDir });
        } else {
          throw new Error(
            `Cannot resolve ancestor ${ancestor} of ref '${ref}'. ` +
              `If using shallow clone, increase clone.depth to at least ${ancestor + 1}.`,
          );
        }
      }
    }
  }

  /** Materialize all repos into the workspace. */
  async materializeAll(repos: readonly RepoConfig[], workspacePath: string): Promise<void> {
    for (const repo of repos) {
      await this.materialize(repo, workspacePath);
    }
  }

  /** Reset repos in workspace to their checkout state. */
  async reset(
    repos: readonly RepoConfig[],
    workspacePath: string,
    strategy: 'hard' | 'recreate',
  ): Promise<void> {
    if (strategy === 'recreate') {
      // Remove and re-materialize
      for (const repo of repos) {
        const targetDir = path.join(workspacePath, repo.path);
        await rm(targetDir, { recursive: true, force: true });
      }
      await this.materializeAll(repos, workspacePath);
      return;
    }

    // strategy === 'hard'
    for (const repo of repos) {
      const targetDir = path.join(workspacePath, repo.path);
      await git(['reset', '--hard', 'HEAD'], { cwd: targetDir });
      await git(['clean', '-fd'], { cwd: targetDir });
    }
  }

  /** Remove the entire cache directory. */
  async cleanCache(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/christso/projects/agentv && bun test packages/core/test/evaluation/workspace/repo-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/evaluation/workspace/repo-manager.ts packages/core/test/evaluation/workspace/repo-manager.test.ts
git commit -m "feat(core): implement RepoManager for git cache and workspace materialization (#410)"
```

---

### Task 5: Wire RepoManager into orchestrator

**Files:**
- Modify: `packages/core/src/evaluation/orchestrator.ts:354-416` (shared workspace lifecycle)
- Modify: `packages/core/src/evaluation/orchestrator.ts:860-916` (per-case workspace lifecycle)
- Modify: `packages/core/src/evaluation/orchestrator.ts:1069-1087` (after_each reset hook)

**Step 1: No new test file needed**

Orchestrator integration is best validated via e2e eval runs (Task 8). The unit tests for RepoManager (Task 4) cover the core logic.

**Step 2: Add import at top of orchestrator.ts**

```typescript
import { RepoManager } from './workspace/repo-manager.js';
```

**Step 3: Wire into shared workspace lifecycle (around line 378)**

After the shared workspace is created (template copy or empty mkdir), add repo materialization:

```typescript
// After: sharedWorkspacePath = await createTempWorkspace(workspaceTemplate, evalRunId, 'shared');
// (or after empty workspace mkdir)

// Materialize repos into shared workspace
const repoManager = suiteWorkspace?.repos?.length ? new RepoManager() : undefined;
if (repoManager && sharedWorkspacePath && suiteWorkspace?.repos) {
  try {
    await repoManager.materializeAll(suiteWorkspace.repos, sharedWorkspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sharedWorkspacePath) {
      await cleanupWorkspace(sharedWorkspacePath).catch(() => {});
    }
    throw new Error(`Failed to materialize repos: ${message}`);
  }
}
```

Also update the `hasSharedWorkspace` check (line 365) to include repos:

```typescript
const hasSharedWorkspace = !!(workspaceTemplate || suiteWorkspace?.before_all || suiteWorkspace?.repos?.length);
```

And ensure a workspace directory exists when repos are configured but no template:

```typescript
if (!sharedWorkspacePath && suiteWorkspace?.repos?.length) {
  sharedWorkspacePath = getWorkspacePath(evalRunId, 'shared');
  await mkdir(sharedWorkspacePath, { recursive: true });
}
```

**Step 4: Wire reset into after_each flow (around line 1069)**

Before the existing `after_each` hook execution, add repo reset:

```typescript
// Reset repos before after_each hook (if configured)
if (
  repoManager &&
  workspacePath &&
  suiteWorkspace?.reset?.after_each &&
  suiteWorkspace.reset.strategy &&
  suiteWorkspace.reset.strategy !== 'none' &&
  suiteWorkspace.repos
) {
  try {
    await repoManager.reset(suiteWorkspace.repos, workspacePath, suiteWorkspace.reset.strategy);
  } catch {
    // Reset failures are non-fatal (like after_each)
  }
}
```

Note: The `repoManager` variable needs to be passed into the per-case evaluation function or made available in the closure. The simplest approach is to pass it via the options object that already flows through the orchestrator.

**Step 5: Wire into per-case workspace lifecycle (around line 860)**

For per-case workspaces (no shared), add similar materialization after workspace creation:

```typescript
// After per-case workspace is created (template copy or empty mkdir):
if (evalCase.workspace?.repos?.length && workspacePath) {
  const perCaseRepoManager = new RepoManager();
  try {
    await perCaseRepoManager.materializeAll(evalCase.workspace.repos, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorResult(
      evalCase,
      target.name,
      nowFn(),
      new Error(`Failed to materialize repos: ${message}`),
      promptInputs,
      provider,
    );
  }
}
```

Also ensure a per-case workspace is created when repos are configured:

```typescript
if (!workspacePath && evalCase.workspace?.repos?.length && evalRunId) {
  workspacePath = getWorkspacePath(evalRunId, evalCase.id);
  await mkdir(workspacePath, { recursive: true });
}
```

**Step 6: Verify typecheck passes**

Run: `cd /home/christso/projects/agentv && bun run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/core/src/evaluation/orchestrator.ts
git commit -m "feat(core): wire RepoManager into orchestrator workspace lifecycle (#410)"
```

---

### Task 6: Remove DEFAULT_SYSTEM_PROMPT from providers

**Files:**
- Modify: `packages/core/src/evaluation/providers/claude.ts:40-44,85-86`
- Modify: `packages/core/src/evaluation/providers/codex.ts:40-44,106-108`
- Modify: `packages/core/src/evaluation/providers/codex-cli.ts:24-28,87-90`
- Modify: `packages/core/src/evaluation/providers/copilot-cli.ts:34-38,224,304-308`
- Modify: `packages/core/src/evaluation/providers/copilot-sdk.ts:44-48,110-118`
- Modify: `packages/core/src/evaluation/providers/pi-coding-agent.ts:28-32,201-203`
- Modify: `packages/core/src/evaluation/providers/vscode-templates.ts:14,34`

**Step 1: No separate test — existing tests should still pass**

The removal is intentional. Verify that existing tests don't assert on the system prompt content.

**Step 2: Remove from each provider**

For **claude.ts, codex.ts, codex-cli.ts, copilot-sdk.ts, pi-coding-agent.ts**: Delete the `DEFAULT_SYSTEM_PROMPT` constant and simplify the system prompt resolution to just use `this.config.systemPrompt`:

```typescript
// Before:
const systemPrompt =
  this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);

// After:
const systemPrompt = this.config.systemPrompt;
```

For **copilot-cli.ts**: Same pattern but in `resolveSystemPrompt` method:

```typescript
// Before:
private resolveSystemPrompt(request: ProviderRequest): string | undefined {
  return this.config.systemPrompt ?? (request.captureFileChanges ? undefined : DEFAULT_SYSTEM_PROMPT);
}

// After:
private resolveSystemPrompt(_request: ProviderRequest): string | undefined {
  return this.config.systemPrompt;
}
```

For **vscode-templates.ts**: Remove the "Do NOT create any additional output files" lines from both template strings (lines 14 and 34). Keep the rest of the template instructions about writing to the response file.

**Step 3: Run full test suite**

Run: `cd /home/christso/projects/agentv && bun run test`
Expected: PASS (no tests should depend on the removed prompt text)

**Step 4: Commit**

```bash
git add packages/core/src/evaluation/providers/claude.ts packages/core/src/evaluation/providers/codex.ts packages/core/src/evaluation/providers/codex-cli.ts packages/core/src/evaluation/providers/copilot-cli.ts packages/core/src/evaluation/providers/copilot-sdk.ts packages/core/src/evaluation/providers/pi-coding-agent.ts packages/core/src/evaluation/providers/vscode-templates.ts
git commit -m "refactor(core): remove default 'do not create files' system prompt from providers (#410)"
```

---

### Task 7: Add `agentv cache clean` CLI command

**Files:**
- Create: `apps/cli/src/commands/cache/index.ts`
- Modify: `apps/cli/src/index.ts:17-33`

**Step 1: Create the cache command**

Create `apps/cli/src/commands/cache/index.ts`:

```typescript
import { command, flag, subcommands } from 'cmd-ts';

import { RepoManager } from '@agentv/core/evaluation/workspace/repo-manager';

const cleanCommand = command({
  name: 'clean',
  description: 'Remove all cached git repositories',
  args: {
    force: flag({
      long: 'force',
      short: 'f',
      description: 'Skip confirmation prompt',
    }),
  },
  handler: async ({ force }) => {
    if (!force) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question('Remove all cached git repos from ~/.agentv/git-cache/? [y/N] ', resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }
    }

    const manager = new RepoManager();
    await manager.cleanCache();
    console.log('Cache cleaned.');
  },
});

export const cacheCommand = subcommands({
  name: 'cache',
  description: 'Manage AgentV cache',
  cmds: {
    clean: cleanCommand,
  },
});
```

**Step 2: Register in CLI index**

In `apps/cli/src/index.ts`, add the import and register the command:

```typescript
import { cacheCommand } from './commands/cache/index.js';

// In the cmds object:
cache: cacheCommand,
```

**Step 3: Verify it builds**

Run: `cd /home/christso/projects/agentv && bun run build`
Expected: PASS

**Step 4: Test manually**

Run: `cd /home/christso/projects/agentv && bun agentv cache clean --force`
Expected: "Cache cleaned." (or no-op if cache doesn't exist)

**Step 5: Commit**

```bash
git add apps/cli/src/commands/cache/index.ts apps/cli/src/index.ts
git commit -m "feat(cli): add agentv cache clean command (#410)"
```

---

### Task 8: Add validation warnings for repo config

**Files:**
- Modify: `apps/cli/src/commands/validate/validate-files.ts` (or wherever custom validation lives)

**Step 1: Identify where custom validation runs**

Check `validate-files.ts` for existing custom validation logic beyond Zod schema validation.

**Step 2: Add validation warnings**

After Zod schema validation passes, add these checks:

```typescript
// Depth vs ancestor warning
for (const repo of workspace.repos ?? []) {
  if (repo.checkout?.ancestor && repo.clone?.depth) {
    if (repo.clone.depth < repo.checkout.ancestor + 1) {
      warnings.push(
        `Repo '${repo.path}': clone.depth (${repo.clone.depth}) may be insufficient for ancestor (${repo.checkout.ancestor}). ` +
        `Recommend depth >= ${repo.checkout.ancestor + 1}.`
      );
    }
  }
}

// Reset without repos warning
if (workspace.reset?.strategy && workspace.reset.strategy !== 'none' && !workspace.repos?.length) {
  warnings.push(`reset.strategy '${workspace.reset.strategy}' has no effect without repos.`);
}

// Reset after_each with per_test isolation warning
if (workspace.reset?.after_each && workspace.isolation === 'per_test') {
  warnings.push(`reset.after_each is redundant with isolation: per_test (each test gets a fresh workspace).`);
}
```

**Step 3: Run validate on a test file**

Run: `cd /home/christso/projects/agentv && bun agentv validate examples/features/rubric/evals/dataset.eval.yaml`
Expected: PASS (existing files have no repo config, so no new warnings)

**Step 4: Commit**

```bash
git add apps/cli/src/commands/validate/
git commit -m "feat(cli): add validation warnings for repo lifecycle config (#410)"
```

---

### Task 9: Export RepoManager from core package

**Files:**
- Modify: `packages/core/src/index.ts` (or the appropriate barrel export file)

**Step 1: Add export**

Find the main exports file and add:

```typescript
export { RepoManager } from './evaluation/workspace/repo-manager.js';
export type { RepoConfig, RepoSource, RepoCheckout, RepoClone, ResetConfig } from './evaluation/types.js';
```

**Step 2: Verify build**

Run: `cd /home/christso/projects/agentv && bun run build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export RepoManager and repo lifecycle types (#410)"
```

---

### Task 10: Build, typecheck, lint, test

**Step 1: Run full quality checks**

```bash
cd /home/christso/projects/agentv && bun run build && bun run typecheck && bun run lint && bun run test
```

Expected: All PASS

**Step 2: Fix any issues found**

Address lint errors, type errors, or test failures.

**Step 3: Final commit if fixes needed**

```bash
git commit -m "fix: address lint/type issues from repo lifecycle feature (#410)"
```

---

### Task 11: Update documentation

**Files:**
- Modify: `apps/web/src/content/docs/` — relevant docs pages for workspace configuration
- Modify: `plugins/agentv-dev/skills/agentv-eval-builder/` — skill reference card if it covers workspace schema

**Step 1: Update docs site**

Add workspace repo lifecycle documentation with examples:
- Single repo + per-test isolation
- Multi-repo shared workspace + hard reset
- Pinned commit + shallow clone over HTTPS
- Cache reuse across eval runs

**Step 2: Update skill reference**

If the eval builder skill references workspace schema, add the new fields.

**Step 3: Commit**

```bash
git add apps/web/ plugins/agentv-dev/
git commit -m "docs: add workspace repo lifecycle documentation (#410)"
```

---

### Task 12: Create follow-up issue for cache GC

**Step 1: Create GitHub issue**

```bash
gh issue create --repo EntityProcess/agentv \
  --title "feat: cache GC for workspace git cache (TTL, LRU, size limits)" \
  --body "Follow-up from #410. Add automatic cache eviction:
- TTL: auto-delete cached repos unused for N days
- LRU: evict least-recently-used repos when size cap exceeded
- Size cap: configurable max disk usage for ~/.agentv/git-cache/
- agentv cache gc command with --max-age and --max-size flags

Currently users can use agentv cache clean to wipe the entire cache."
```

**Step 2: Commit (nothing to commit, just issue created)**
