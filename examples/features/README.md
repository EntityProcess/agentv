# AgentV Feature Examples

Focused examples for specific AgentV capabilities. Find your use case below, then open the linked directory for a runnable example.

---

### Write your first eval
| Example | Description |
|---------|-------------|
| [basic](basic/) | Core schema: input, expected output, file references, multi-turn |
| [basic-jsonl](basic-jsonl/) | Load test cases from an external JSONL file |
| [default-graders](default-graders/) | Apply the same assertions to every test without repeating them |

---

### Grade response quality with an LLM judge
| Example | Description |
|---------|-------------|
| [rubric](rubric/) | Boolean rubric criteria — pass/fail each with a code grader or LLM check |
| [weighted-graders](weighted-graders/) | Multiple named `llm-grader` assertions with per-grader weights |
| [composite](composite/) | Safety gate and weighted aggregation patterns |
| [threshold-grader](threshold-grader/) | Pass a test if a configurable percentage of sub-graders pass |
| [multi-turn-conversation](multi-turn-conversation/) | Grade a multi-turn conversation with per-turn score breakdowns |
| [preprocessors](preprocessors/) | Convert `ContentFile` outputs into grader-readable text before `llm-grader` runs |

---

### Deterministic checks (no LLM required)
| Example | Description |
|---------|-------------|
| [assert](assert/) | Core built-ins: `contains`, `regex`, `is-json`, `equals`, `starts_with`, `ends_with` |
| [assert-extended](assert-extended/) | Extended variants: `contains_any`, `icontains`, `icontains_all`, regex flags |
| [deterministic-graders](deterministic-graders/) | Full showcase of all deterministic assertion types |
| [nlp-metrics](nlp-metrics/) | ROUGE, BLEU, cosine/Jaccard similarity, Levenshtein as code graders |

---

### Write custom graders in code
| Example | Description |
|---------|-------------|
| [code-grader-sdk](code-grader-sdk/) | TypeScript code graders using `defineCodeGrader()` from `@agentv/eval` |
| [code-grader-with-llm-calls](code-grader-with-llm-calls/) | Code graders that make LLM calls via a target proxy |
| [eval-assert-demo](eval-assert-demo/) | Code graders runnable both in a suite and individually via `agentv eval assert` |
| [functional-grading](functional-grading/) | Install dependencies, compile, and run tests against agent-generated code |

---

### Evaluate tool use and agent behavior
| Example | Description |
|---------|-------------|
| [tool-trajectory-simple](tool-trajectory-simple/) | Validate expected tool call sequences |
| [tool-trajectory-advanced](tool-trajectory-advanced/) | Tool trajectory checks with `expected_output` and per-call assertions |
| [latency-assertions](latency-assertions/) | Assert `max_duration_ms` per tool call to catch performance regressions |
| [tool-evaluation-plugins](tool-evaluation-plugins/) | F1 precision/recall scoring for tool-call accuracy |
| [trace-evaluation](trace-evaluation/) | Inspect agent internals: LLM call counts, tool executions, step durations |

---

### Evaluate without re-running the agent (offline)
| Example | Description |
|---------|-------------|
| [copilot-log-eval](copilot-log-eval/) | Replay Copilot CLI session transcripts from disk — no LLM API key needed |
| [trace-analysis](trace-analysis/) | Inspect eval results with `agentv trace` — summaries, trees, latency percentiles |
| [agent-skills-evals](agent-skills-evals/) | Evaluate Claude Code skills using `evals.json` or `EVAL.yaml` format |

---

### Load tests from files or external sources
| Example | Description |
|---------|-------------|
| [external-datasets](external-datasets/) | Load test cases from YAML/JSONL files using `file://` references and globs |
| [input-files-shorthand](input-files-shorthand/) | Attach files to every test using a compact shorthand |
| [suite-level-input](suite-level-input/) | Prepend a shared system prompt to every test in the suite |
| [suite-level-input-files](suite-level-input-files/) | Share file attachments across every test in the suite |
| [env-interpolation](env-interpolation/) | Inject environment variables into eval config with `${{ VAR }}` |

---

### Benchmark across models or measure consistency
| Example | Description |
|---------|-------------|
| [matrix-evaluation](matrix-evaluation/) | Run the same tests against multiple targets and display a score matrix |
| [benchmark-tooling](benchmark-tooling/) | N-way benchmarking with `agentv compare` cross-model score matrix |
| [trials](trials/) | Repeat each test N times with `pass@k` strategy to handle non-determinism |
| [trial-output-consistency](trial-output-consistency/) | Measure output consistency across trials using pairwise cosine similarity |
| [compare](compare/) | Compare a run against a stored baseline |

---

### Track cost, latency, and token usage
| Example | Description |
|---------|-------------|
| [execution-metrics](execution-metrics/) | Assert on token count, cost, and latency per test |
| [latency-assertions](latency-assertions/) | Per-tool-call latency constraints (also listed under tool evaluation) |

---

### Workspace and agent setup
| Example | Description |
|---------|-------------|
| [workspace-setup-script](workspace-setup-script/) | Multi-step setup with the `before_all` lifecycle hook |
| [workspace-multi-repo](workspace-multi-repo/) | Multi-repo workspace using a VS Code `.code-workspace` file |
| [workspace-shared-config](workspace-shared-config/) | Define a `workspace.yaml` once and reference it across eval files |
| [repo-lifecycle](repo-lifecycle/) | Clone a git repo into the workspace and target the agent at it |
| [file-changes](file-changes/) | Capture workspace file changes made by the agent across test runs |
| [file-changes-graders](file-changes-graders/) | Grade file diffs with rubrics and LLM graders |
| [local-cli](local-cli/) | Define and invoke local CLI targets |
| [batch-cli](batch-cli/) | Run bulk evaluations from the CLI |

---

### Export results to an observability platform
| Example | Description |
|---------|-------------|
| [langfuse-export](langfuse-export/) | Export eval traces to Langfuse via OpenTelemetry OTLP/HTTP |
| [document-extraction](document-extraction/) | Evaluate structured data extracted from documents |

---

### Use the TypeScript SDK
| Example | Description |
|---------|-------------|
| [sdk-custom-assertion](sdk-custom-assertion/) | Custom assertion types using `defineAssertion()` |
| [sdk-programmatic-api](sdk-programmatic-api/) | Programmatic evaluation using `evaluate()` |
| [sdk-config-file](sdk-config-file/) | Typed configuration with `defineConfig()` |
| [prompt-template-sdk](prompt-template-sdk/) | Custom LLM grader prompts using `definePromptTemplate()` |

---

## All Examples (A–Z)

| Example | Use Case |
|---------|----------|
| [agent-skills-evals](agent-skills-evals/) | Offline evaluation of Claude Code skills |
| [assert](assert/) | Deterministic assertions |
| [assert-extended](assert-extended/) | Deterministic assertions |
| [basic](basic/) | Getting started |
| [basic-jsonl](basic-jsonl/) | Getting started |
| [batch-cli](batch-cli/) | Workspace & targets |
| [benchmark-tooling](benchmark-tooling/) | Benchmarking |
| [code-grader-sdk](code-grader-sdk/) | Custom graders |
| [code-grader-with-llm-calls](code-grader-with-llm-calls/) | Custom graders |
| [compare](compare/) | Benchmarking |
| [composite](composite/) | LLM grading |
| [copilot-log-eval](copilot-log-eval/) | Offline evaluation |
| [default-graders](default-graders/) | Getting started |
| [deterministic-graders](deterministic-graders/) | Deterministic assertions |
| [document-extraction](document-extraction/) | Observability & export |
| [env-interpolation](env-interpolation/) | Dataset & input |
| [eval-assert-demo](eval-assert-demo/) | Custom graders |
| [execution-metrics](execution-metrics/) | Cost, latency & tokens |
| [external-datasets](external-datasets/) | Dataset & input |
| [file-changes](file-changes/) | Workspace & targets |
| [file-changes-graders](file-changes-graders/) | Workspace & targets |
| [functional-grading](functional-grading/) | Custom graders |
| [input-files-shorthand](input-files-shorthand/) | Dataset & input |
| [langfuse-export](langfuse-export/) | Observability & export |
| [latency-assertions](latency-assertions/) | Tool & agent evaluation |
| [local-cli](local-cli/) | Workspace & targets |
| [matrix-evaluation](matrix-evaluation/) | Benchmarking |
| [multi-turn-conversation](multi-turn-conversation/) | LLM grading |
| [nlp-metrics](nlp-metrics/) | Deterministic assertions |
| [preprocessors](preprocessors/) | LLM grading |
| [prompt-template-sdk](prompt-template-sdk/) | TypeScript SDK |
| [repo-lifecycle](repo-lifecycle/) | Workspace & targets |
| [rubric](rubric/) | LLM grading |
| [sdk-config-file](sdk-config-file/) | TypeScript SDK |
| [sdk-custom-assertion](sdk-custom-assertion/) | TypeScript SDK |
| [sdk-programmatic-api](sdk-programmatic-api/) | TypeScript SDK |
| [suite-level-input](suite-level-input/) | Dataset & input |
| [suite-level-input-files](suite-level-input-files/) | Dataset & input |
| [threshold-grader](threshold-grader/) | LLM grading |
| [tool-evaluation-plugins](tool-evaluation-plugins/) | Tool & agent evaluation |
| [tool-trajectory-advanced](tool-trajectory-advanced/) | Tool & agent evaluation |
| [tool-trajectory-simple](tool-trajectory-simple/) | Tool & agent evaluation |
| [trace-analysis](trace-analysis/) | Offline evaluation |
| [trace-evaluation](trace-evaluation/) | Tool & agent evaluation |
| [trial-output-consistency](trial-output-consistency/) | Benchmarking |
| [trials](trials/) | Benchmarking |
| [weighted-graders](weighted-graders/) | LLM grading |
| [workspace-multi-repo](workspace-multi-repo/) | Workspace & targets |
| [workspace-setup-script](workspace-setup-script/) | Workspace & targets |
| [workspace-shared-config](workspace-shared-config/) | Workspace & targets |
