# AgentV Showcase Examples

End-to-end real-world evaluation scenarios. Each example is runnable and demonstrates how to compose AgentV primitives for a production use case.

---

### Grade responses with a weighted LLM panel

| Example | Description |
|---------|-------------|
| [multi-model-benchmark](multi-model-benchmark/) | Run the same suite against multiple models with weighted rubric graders (`accuracy 3×`, `completeness 2×`, `clarity 1×`) and `agentv compare` for side-by-side regression gating |
| [offline-grader-benchmark](offline-grader-benchmark/) | Benchmark grader quality against human-labelled data by replaying frozen outputs through multiple LLM graders and scoring majority-vote accuracy |

---

### Evaluate classification and domain-specific tasks

| Example | Description |
|---------|-------------|
| [export-screening](export-screening/) | AI export-control risk classification (Low/Medium/High) with JSON validation and precision/recall/F1 metrics |
| [cw-incident-triage](cw-incident-triage/) | Support ticket criticality classification (CR1–CR9) with edge-case fixtures for prompt optimisation |
| [psychotherapy](psychotherapy/) | Therapeutic framework routing and application across three specialised components with per-framework rubric graders |

---

### Evaluate tool use and agent behavior

| Example | Description |
|---------|-------------|
| [tool-evaluation-plugins](tool-evaluation-plugins/) | Tool selection correctness, efficiency scoring, and pairwise comparison as code-grader plugins — includes a decision table for when to use plugins vs the built-in `tool_trajectory` grader |

---

### Evaluate code agents and multi-repo workflows

| Example | Description |
|---------|-------------|
| [cross-repo-sync](cross-repo-sync/) | Evaluate a coding agent's ability to sync spec docs across two repos, using per-test git lifecycle hooks and diff-based validation |

---

### Verify your graders are reliable

| Example | Description |
|---------|-------------|
| [grader-conformance](grader-conformance/) | Meta-harness that checks an grader for output compatibility and verdict stability, reporting flip rate, mean/variance, and bound violations across repeated runs |

---

## All Examples (A–Z)

| Example | Use Case |
|---------|----------|
| [cross-repo-sync](cross-repo-sync/) | Code agents & multi-repo workflows |
| [cw-incident-triage](cw-incident-triage/) | Classification tasks |
| [grader-conformance](grader-conformance/) | Grader reliability |
| [export-screening](export-screening/) | Classification tasks |
| [multi-model-benchmark](multi-model-benchmark/) | Weighted LLM panel |
| [offline-grader-benchmark](offline-grader-benchmark/) | Weighted LLM panel |
| [psychotherapy](psychotherapy/) | Domain-specific grading |
| [tool-evaluation-plugins](tool-evaluation-plugins/) | Tool use & agent behavior |
