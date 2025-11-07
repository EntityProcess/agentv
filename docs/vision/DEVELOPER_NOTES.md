# AgentEvo Developer Notes

## 1. Overview
Deliver a TypeScript codebase providing:
- Artifact management (versioned JSON, hashing, ledger).
- YAML evaluation panel parsing & scoring.
- Dual execution (internal/external).
- Optimization (heuristic mutators → beam textual gradients later).
- Evaluation-only workflow.
- Tool registry (CLI & HTTP).
- Promotion / rollback governance.

## 2. Module Layout

| Module | Path | Responsibility |
|--------|------|----------------|
| Artifacts | `src/artifacts/` | Load, validate, hash, promote, rollback |
| Panel | `src/panel/` | YAML parsing, schema validation |
| Scoring | `src/scoring/` | Task-level metrics + aggregation |
| Optimizer | `src/optimizer/` | Mutators, candidate enumeration, future beam |
| Executor Internal | `src/executor/internal/` | Planner → tool caller → summarizer pipeline |
| External Adapters | `src/executor/external/` | Invoke external agent + fetch traces |
| Tools | `src/tools/` | Registry, CLI/http execution wrappers |
| Traces | `src/traces/` | Normalization of internal & external runs |
| Safety | `src/safety/` | PII, rule violations, gating checks |
| Eval (Panel Runner) | `src/eval/` | Evaluation-only logic |
| Diff | `src/diff/` | Report comparison utilities |
| CLI | `src/cli/` | Commander commands |
| Server | `src/server/` | Fastify endpoints |
| Logging | `src/logging/` | Structured JSON + optional OTel |
| Plugins | `src/plugins/` | Mutator & metric extension points |

## 3. Tech Stack
- Node.js ≥ 20, TypeScript strict
- pnpm
- Zod for interfaces & runtime validation
- `yaml` for panel parsing
- Fastify for API
- Pino for logging
- Vitest for tests
- Optional embedding provider for semantic correctness (future flag)

## 4. Core Interfaces
```ts
interface PromptArtifact {
  version: string;
  system: { text: string };
  planner: { text: string };
  tool_caller: { text: string };
  summarizer: { text: string };
  bullets: Record<string, string[]>;
  model_config?: { temperature?: number; top_p?: number };
  hash: string;
  created_at?: string;
  changelog?: ChangelogEntry[];
}

interface PanelTask {
  id: string;
  task: string;
  expected?: string;
  metrics: {
    correctness?: 'exact' | 'semantic' | 'judge';
    latency_target_ms?: number;
    max_tool_calls?: number;
    sources_required?: number;
    fast?: boolean;
  };
}

interface PanelConfig {
  tasks: PanelTask[];
  scoring: { weights: Record<string, number>; };
  thresholds: { promote_min_improvement: number; correctness_min: number; };
}

interface TraceSpan {
  stage: 'planner' | 'tool' | 'summarizer' | string;
  start: number;
  end: number;
  toolName?: string;
  error?: boolean;
  tokensUsed?: number;
  raw?: Record<string, any>;
}

interface TraceRun {
  id: string;
  artifactVersion: string;
  task: string;
  finalOutput: string;
  spans: TraceSpan[];
  raw: Record<string, any>;
}

interface TaskMetrics {
  correctness: number;
  latency: number;
  cost: number;
  toolEfficiency: number;
  robustness: number;
  safety?: number;
}

interface AggregateMetrics extends TaskMetrics { score: number; }

interface EvalReport {
  artifactVersion: string;
  timestamp: string;
  aggregate: AggregateMetrics;
  perTask: {
    id: string;
    metrics: TaskMetrics & { score: number; latency_ms: number; toolCalls: number; };
    outputSnippet: string;
    expectedSnippet?: string;
  }[];
  mode: 'internal' | 'external';
  agentType?: string;
  artifactHash: string;
}

interface ExternalAgentAdapter {
  invoke(args: { task: string; artifact: PromptArtifact; artifactVersion: string; }): Promise<{ output: string; runId?: string; }>;
  fetchTraces(args: { artifactVersion: string; runId?: string; }): Promise<TraceRun[]>;
}
```

## 5. Execution Flow

### Internal Mode
1. Render planner → call LLM → parse steps.
2. For each step: render tool caller → select tool → execute CLI/API tool → record span.
3. Render summarizer.
4. Construct `TraceRun` with spans & final output.

### External Mode
1. Adapter passes artifact payload to agent endpoint (task + artifactVersion).
2. Agent runs its internal workflow.
3. Adapter fetches traces or raw result (with artifactVersion tag).
4. Normalize to `TraceRun`.

## 6. Evaluation-Only Flow
```ts
evaluateArtifact({
  artifactPath, panelPath, mode, agentType, agentEndpoint, include, exclude
}): EvalReport
```
Steps:
- Load artifact + panel.
- Filter tasks (include/exclude + optional `--fast`).
- For each task: produce `TraceRun` (external/internal).
- Score with `scoreRun` → accumulate metrics → build report JSON.
- Write report if `--report` provided.

## 7. Scoring Details
- correctness:
  - exact: normalized string match.
  - semantic: embedding cosine similarity (> threshold mapped to [0,1]).
  - judge: secondary LLM returns numeric rating.
- latency: transform total elapsed vs target into [0,1].
- toolEfficiency: `1 - max(0,(actual - cap)/cap)`.
- robustness: `1 - errorSpanRatio`.
- cost: inverse normalized token or billing units.
- composite: weighted sum from panel scoring.weights.

## 8. Mutators (P0)
- Temperature tweak ±0.05.
- Add/remove single efficiency bullet.
- Reorder planner lines (swap two lines).
- Deduplicate repeated sentences.
Enumeration ≤ 6 → pick best improvement.

P1 (Beam + Critique):
- Use planner + summarizer outputs + spans as context.
- LLM critique returns suggestions array; apply minimal edits.
- Evaluate; maintain beam size K.

## 9. Safety Checks
- PII regex shortlist (email, phone, SSN-like patterns).
- Source coverage: count bracketed citations `[n]` vs required.
- Tool thrash detection: repeated queries with low edit distance.
- Mandatory bullet presence.

Fail → candidate flagged `safe=false`.

## 10. Artifact Hashing / Ledger
- Hash canonical JSON (sorted keys).
- Ledger `artifacts/versions.jsonl`:
```
{"version":"v13","hash":"sha256:abc123","timestamp":"...","action":"promote","score":0.86}
{"version":"v12","hash":"sha256:def456","timestamp":"...","action":"rollback","target":"v11"}
```

## 11. CLI Commands

| Command | Notes |
|---------|-------|
| `init` | Scaffold `current.json` + `panel.yaml` |
| `run` | Single task execute (mode flag) |
| `eval` | Panel scoring only |
| `optimize` | Generate `candidate.json` |
| `promote` | Move candidate → current |
| `rollback` | Restore previous version |
| `tool add` | Register tool |
| `panel validate` | Schema check |
| `diff report` | Compare metrics across two eval reports |

## 12. Diff Report Logic
Compute metric deltas, changed bullets, planner line diffs (Levenshtein / positional shifts). Output console table + optional JSON.

## 13. Exit Codes
| Code | Reason |
|------|--------|
| 0 | Success |
| 10 | No improvement (optimize) |
| 20 | Safety violation |
| 30 | Invalid artifact/panel |
| 40 | Trace ingestion failure |
| 50 | Hash/integrity mismatch |

## 14. Testing Strategy
| Category | Tests |
|----------|-------|
| Unit | Artifact parse, hash stable, panel validate |
| Scoring | correctness variants, latency mapping |
| Mutators | Each returns valid & different artifact |
| Eval-only | Deterministic report with fixed seed |
| External adapter | Mock responses & trace normalization |
| Safety | PII triggers block |
| Diff | Numeric deltas correct |

## 15. Performance Targets
- 20-task panel scoring (< 250 ms excluding LLM calls).
- Internal executor overhead (< 100 ms baseline + tool runtimes).
- Memory footprint minimal (file-based, no DB until later).

## 16. Observability
- Structured logs per span:
  - `{"stage":"tool","tool":"search","latency_ms":410}`
- Optional OpenTelemetry instrumentation around `run`, `eval`, `optimize`.
- Report includes `seed`, `cacheUsed`.

## 17. Caching
- Cache `(artifactHash, taskId, mode)` results in `.agentevo/cache/`.
- `--no-cache` bypasses.
- Semantic / judge results cached separately.

## 18. Security
- Shell tools: sanitize interpolations, forbid dangerous chars.
- HTTP tools: limit allowed headers; timeout + body size caps.
- No secrets in artifact; environment variables for API keys.

## 19. Plugin Hooks
```ts
interface ArtifactMutator { name: string; apply(a: PromptArtifact): PromptArtifact; }
interface MetricPlugin { name: string; compute(run: TraceRun): number; }
registerMutator(mutator); registerMetric(plugin);
```

## 20. Roadmap
| Phase | Scope |
|-------|-------|
| P0 | Core artifact, eval-only, internal run |
| P1 | External adapter (generic HTTP), optimize heuristics |
| P2 | Beam critique, diff report tool |
| P3 | Shadow A/B, auto canary gating |
| P4 | Dashboard + remote storage |
| P5 | Plugin ecosystem |

## 21. Sprint 1 Deliverables
- `current.json`, `panel.yaml`, `init`, `eval`, `panel validate`.
- Internal run pipeline.
- Basic scoring (exact correctness, latency).
- Artifact hash + ledger scaffold.

## 22. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Overfitting to panel | Holdout tasks, rotate monthly |
| Sparse external traces | Fallback to output-only scoring |
| Mutator instability | Strict diff size limit & revert on regression |
| PII missed | Expand regex set + optional external classifier flag |

## 23. Example Eval Report Skeleton
```json
{
  "artifactVersion": "v13",
  "timestamp": "2025-11-07T21:25:34Z",
  "aggregate": {
    "correctness": 0.88,
    "latency": 0.76,
    "cost": 0.83,
    "toolEfficiency": 0.79,
    "robustness": 0.94,
    "score": 0.864
  },
  "perTask": [
    {
      "id": "t1",
      "metrics": {
        "correctness": 0.92,
        "latency_ms": 1180,
        "toolCalls": 4,
        "toolEfficiency": 0.80,
        "robustness": 1.0,
        "costScore": 0.84,
        "score": 0.887
      },
      "outputSnippet": "Embeddings map tokens...",
      "expectedSnippet": "High-level overview..."
    }
  ],
  "mode": "external",
  "agentType": "claude-code",
  "artifactHash": "sha256:abc123"
}
```

## 24. Pseudocode: Eval Command
```ts
async function evalCommand(opts) {
  const artifact = loadArtifact(opts.artifact);
  const panel = loadPanel(opts.panel);
  const tasks = filterTasks(panel.tasks, opts.include, opts.exclude, opts.fast);
  const adapter = opts.mode === 'external'
    ? loadExternalAdapter(opts.agentType, opts.agentEndpoint)
    : null;

  const runs = [];
  for (const task of tasks) {
    const run = opts.mode === 'external'
      ? await externalInvoke(adapter, task, artifact)
      : await internalExecute(task, artifact);
    runs.push(run);
  }
  const scored = runs.map(r => scoreRun(r, panel.scoring.weights, panel.thresholds));
  const report = buildEvalReport(artifact, panel, scored, opts.mode, opts.agentType);
  if (opts.report) writeFile(opts.report, JSON.stringify(report, null, 2));
  console.log(formatEvalSummary(report));
}
```

---

Use this specification as the implementation blueprint. End-user README remains concise; evaluation-only usage is fully supported without optimization. 