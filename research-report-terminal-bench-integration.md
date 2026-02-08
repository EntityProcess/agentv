# Terminal-Bench Integration Research Report

**Date:** 2026-02-07
**Branch:** `research/tbench-integration`
**Author:** Claude (Research Agent)

---

## Executive Summary

Terminal-Bench (tbench.ai) is a Stanford x Laude Institute collaboration that evaluates AI agents on real-world terminal tasks in Docker sandboxes. This report analyzes features from Terminal-Bench that could enhance AgentV's evaluation capabilities.

**Key Integration Opportunities:**
1. Real terminal sandbox execution environment
2. Adapter pattern for external benchmark compatibility
3. Failure mode taxonomy
4. Pass@k metrics for multi-attempt evaluation
5. Session recording (Asciinema)
6. Checkpoint/resume capability

---

## 1. Terminal-Bench Overview

### What It Is
Terminal-Bench is a production-grade evaluation framework for testing autonomous AI agents in realistic terminal environments. It focuses on end-to-end task completion rather than isolated code generation.

### Core Architecture

```
                    ┌─────────────────────────────────────┐
                    │            CLI (tb run)             │
                    └───────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────┐
                    │        Harness (Orchestrator)       │
                    │  - Concurrent task execution        │
                    │  - Checkpoint/resume                │
                    │  - Result aggregation               │
                    └───────────────┬─────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
┌────────▼────────┐      ┌──────────▼──────────┐     ┌────────▼────────┐
│   Agent Layer   │      │   Terminal Layer    │     │  Dataset Layer  │
│  - Terminus     │      │  - Docker sandbox   │     │  - Task loader  │
│  - Claude Code  │      │  - tmux sessions    │     │  - Registry     │
│  - OpenHands    │      │  - Asciinema        │     │  - Versioning   │
│  - Custom       │      │  - Output capture   │     │  - Filters      │
└─────────────────┘      └─────────────────────┘     └─────────────────┘
```

### Key Differentiators from AgentV

| Aspect | Terminal-Bench | AgentV |
|--------|---------------|--------|
| **Execution** | Real Docker containers | Provider abstraction |
| **Task Format** | Directory with Dockerfile + test script | YAML eval case |
| **Scoring** | Binary pass/fail per task | 0-1 continuous score |
| **Multi-attempt** | Pass@k native | Not supported |
| **Recording** | Asciinema session capture | Tool call traces |
| **Resume** | Checkpoint-based | Not supported |

---

## 2. Features for Integration

### 2.1 Real Terminal Sandbox Execution

**What Terminal-Bench Has:**
- Full Docker container per task with complete system access
- tmux-based shell interaction supporting interactive programs (vim, less, git)
- Non-blocking/blocking command execution modes
- Real networking, filesystem, package management

**Integration Opportunity:**
Add a new `docker-sandbox` provider type that:
- Executes agents in isolated Docker containers
- Captures real terminal output (not just tool call traces)
- Supports multi-step shell interactions

**Effort Level:** High (new provider type + Docker orchestration)

**Value:** Enables testing agents on system-level tasks (DevOps, security, infrastructure)

---

### 2.2 Adapter Pattern for External Benchmarks

**What Terminal-Bench Has:**
15+ adapters converting external benchmarks to Terminal-Bench format:
- SWE-bench (66.4% parity verified)
- CyBench (40 CTF challenges, 100% oracle validation)
- MLEBench, USACO, AlgoTune, DevEval, EvoEval

**Integration Opportunity:**
Create an adapter specification for AgentV:
```yaml
# .agentv/adapters/swebench.yaml
name: swebench
source:
  type: huggingface
  dataset: princeton-nlp/SWE-bench_Lite
transform:
  input: "{{ item.problem_statement }}"
  expected_outcome: "All tests pass after applying patch"
  reference_answer: "{{ item.patch }}"
evaluator:
  type: code_judge
  command: "python adapters/swebench/evaluate.py"
```

**Effort Level:** Medium (specification design + example adapters)

**Value:** Opens AgentV to existing benchmark ecosystems

---

### 2.3 Failure Mode Taxonomy

**What Terminal-Bench Has:**
9 distinct failure modes tracked per trial:
- `NONE` - Success
- `AGENT_TIMEOUT` - Agent exceeded time limit
- `TEST_TIMEOUT` - Tests exceeded time limit
- `PARSE_ERROR` - Could not parse test output
- `CONTEXT_LENGTH_EXCEEDED` - Hit model context limit
- `OUTPUT_LENGTH_EXCEEDED` - Hit model output limit
- `AGENT_DIED` - Agent process crashed
- `DOCKER_ERROR` - Container failed
- `UNKNOWN` - Uncategorized failure

**Integration Opportunity:**
Add failure mode tracking to AgentV's `EvaluationResult`:
```typescript
interface EvaluationResult {
  // existing fields...
  failureMode?:
    | 'none'
    | 'agent_timeout'
    | 'evaluator_timeout'
    | 'context_exceeded'
    | 'output_exceeded'
    | 'provider_error'
    | 'evaluator_error'
    | 'unknown';
}
```

**Effort Level:** Low (add field to result schema)

**Value:** Better debugging and failure analysis

---

### 2.4 Pass@k Multi-Attempt Metrics

**What Terminal-Bench Has:**
```python
pass@k = percentage of tasks with ≥1 success in k attempts
# Calculated using combinatorial estimator
# Common k values: 2, 4, 5, 10
```

CLI supports: `--n-attempts 3` to run each task multiple times

**Integration Opportunity:**
Add multi-attempt support to AgentV:

```yaml
# Dataset YAML
execution:
  attempts: 3
  aggregation: pass_at_k  # or: best, worst, average
```

```bash
# CLI
agentv eval dataset.yaml --attempts 3 --pass-at-k 2
```

Output:
```json
{
  "evalId": "task-1",
  "attempts": [
    {"attemptId": 1, "score": 0.4, "verdict": "fail"},
    {"attemptId": 2, "score": 0.9, "verdict": "pass"},
    {"attemptId": 3, "score": 0.7, "verdict": "borderline"}
  ],
  "passAtK": {"1": false, "2": true, "3": true},
  "bestScore": 0.9,
  "aggregateVerdict": "pass"
}
```

**Effort Level:** Medium (harness changes + new aggregation logic)

**Value:** Measures agent reliability/consistency, essential for production agents

---

### 2.5 Session Recording

**What Terminal-Bench Has:**
- Asciinema cast files (JSON with timing data)
- Full terminal replay capability
- Enables forensic analysis of agent behavior

**Integration Opportunity:**
Add trace recording mode:

```yaml
execution:
  recording: true
  recording_format: asciinema | jsonl
```

For non-terminal providers, record tool calls with timing:
```json
{
  "timestamp": 1707321600.123,
  "event": "tool_call",
  "tool": "read_file",
  "input": {"path": "/app/main.py"},
  "output": "def main(): ...",
  "durationMs": 45
}
```

**Effort Level:** Low-Medium (extend existing trace capture)

**Value:** Debugging, demos, analysis

---

### 2.6 Checkpoint/Resume Capability

**What Terminal-Bench Has:**
- Run lock files store configuration
- Safe resumption of interrupted runs
- Partial completion tracking
- Configuration consistency validation

**Integration Opportunity:**
Add checkpoint support for large-scale evaluations:

```bash
# Initial run (interrupted)
agentv eval large-dataset.yaml --checkpoint ./checkpoint.json

# Resume
agentv eval --resume ./checkpoint.json
```

Checkpoint file:
```json
{
  "runId": "run-123",
  "datasetPath": "large-dataset.yaml",
  "config": {...},
  "completed": ["case-1", "case-2"],
  "pending": ["case-3", "case-4", ...],
  "timestamp": "2026-02-07T12:00:00Z"
}
```

**Effort Level:** Medium (state management + CLI changes)

**Value:** Essential for large-scale evaluations (100+ cases)

---

### 2.7 Task Complexity Metadata

**What Terminal-Bench Has:**
```yaml
# task.yaml
difficulty: [easy | medium | hard]
expert_time_estimate_min: 45
junior_time_estimate_min: 180
estimated_duration_sec: null  # Historical estimate
```

**Integration Opportunity:**
Add optional complexity metadata to eval cases:

```yaml
evalcases:
  - id: complex-task
    metadata:
      difficulty: hard
      estimated_expert_time_min: 60
      category: "data-engineering"
      tags: [sql, python, etl]
```

CLI could then filter/sort by difficulty:
```bash
agentv eval dataset.yaml --difficulty easy,medium
```

**Effort Level:** Low (schema extension)

**Value:** Better test organization, progressive difficulty testing

---

### 2.8 Leaderboard/Results Database

**What Terminal-Bench Has:**
- PostgreSQL/Supabase backend
- Public leaderboard with verification badges
- S3 integration for result archival
- Dataset versioning via registry

**Integration Opportunity:**
This is likely out of scope for AgentV's core (per design principles), but could be supported via:
- JSONL export compatible with common analytics tools
- Standardized result schema for third-party leaderboards

**Effort Level:** Out of scope (external tool)

**Value:** Community comparison, reproducibility

---

## 3. Feature Priority Matrix

| Feature | Value | Effort | Priority |
|---------|-------|--------|----------|
| Failure Mode Taxonomy | High | Low | **P1** |
| Pass@k Metrics | High | Medium | **P1** |
| Task Complexity Metadata | Medium | Low | **P2** |
| Session Recording | Medium | Low-Medium | **P2** |
| Checkpoint/Resume | High | Medium | **P2** |
| Adapter Pattern | High | Medium | **P3** |
| Docker Sandbox Provider | High | High | **P3** |

---

## 4. Recommended Implementation Order

### Phase 1: Quick Wins (Low Effort, High Value)
1. **Add failure mode field** to EvaluationResult schema
2. **Add metadata block** to eval case schema for difficulty/tags

### Phase 2: Core Enhancements (Medium Effort, High Value)
3. **Implement pass@k** with multi-attempt support
4. **Add checkpoint/resume** for large evaluations
5. **Enhance trace recording** with timing data

### Phase 3: Ecosystem Expansion (High Effort, High Value)
6. **Design adapter specification** for external benchmarks
7. **Create SWE-bench adapter** as reference implementation
8. **Add docker-sandbox provider** (optional, specialized use case)

---

## 5. Alignment with AgentV Design Principles

Per CLAUDE.md:

| Principle | Terminal-Bench Feature | Alignment |
|-----------|----------------------|-----------|
| Lightweight Core | Failure modes, metadata | ✅ Schema additions only |
| Plugin Extensibility | Adapters | ✅ External benchmark plugins |
| Built-ins for Primitives | Pass@k | ✅ Universal metric |
| Non-Breaking Extensions | All proposed | ✅ Optional fields |
| AI-First Design | Complexity metadata | ✅ Helps AI prioritize |

---

## 6. Technical Notes

### Terminal-Bench Tech Stack
- Python 3.12+, Poetry/uv
- Docker (required)
- PostgreSQL/Supabase
- Streamlit dashboard
- LiteLLM for multi-provider support

### Task Format Comparison

**Terminal-Bench Task:**
```
task-name/
├── task.yaml           # Metadata
├── solution.yaml       # Reference solution
├── Dockerfile          # Environment
├── docker-compose.yaml # Multi-container (optional)
├── run-tests.sh        # Test script
└── tests/
    └── test_outputs.py # Pytest assertions
```

**AgentV Eval Case:**
```yaml
evalcases:
  - id: task-name
    input: "..."
    expected_outcome: "..."
    execution:
      evaluators:
        - type: code_judge
          command: "python test.py"
```

The key difference: Terminal-Bench is environment-centric (Docker), AgentV is evaluation-centric (scoring rubrics).

---

## 7. Conclusion

Terminal-Bench offers several features that would enhance AgentV:

1. **Failure mode taxonomy** - Low effort, immediate debugging value
2. **Pass@k metrics** - Essential for reliability measurement
3. **Checkpoint/resume** - Required for production-scale evaluations

The adapter pattern is particularly interesting for ecosystem growth, allowing AgentV to consume SWE-bench, CyBench, and other benchmarks without reimplementing their task definitions.

Docker sandbox execution is valuable but represents a significant architectural shift. It may be better suited as an optional provider rather than a core feature, aligned with AgentV's plugin-first philosophy.

---

## References

- [Terminal-Bench GitHub](https://github.com/laude-institute/terminal-bench)
- [tbench.ai](https://www.tbench.ai/)
- [Terminal-Bench Paper](https://arxiv.org/abs/2601.11868)
- [AgentV Repository](https://github.com/your-org/agentv)
