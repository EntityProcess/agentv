# Phoenix Adapter Support Matrix

This is an internal legacy support matrix for the earlier deterministic
YAML-to-Phoenix adapter fixture. It is not the supported AgentV product path:
AgentV does not export or project completed runs, traces, transcripts, datasets,
experiments, or indexes into Phoenix.

The current supported Phoenix boundary is link-out correlation from safe
`external_trace` metadata when Codex, Arize, or another hook already emitted
spans independently.

If the legacy fixture is run for internal parity checks, its deterministic
coverage is:

| AgentV family | Phoenix status |
| --- | --- |
| `contains` | Supported by deterministic adapter |
| `regex` | Supported by deterministic adapter |
| `equals` | Supported by deterministic adapter |
| `is-json` | Supported by deterministic adapter |
| `llm-grader` | Reported as unsupported in first pass |
| `rubrics` | Reported as unsupported in first pass |
| `code-grader` | Reported as unsupported in first pass |
| `composite` | Reported as unsupported in first pass |
| `field-accuracy` | Reported as unsupported in first pass |
| `execution-metrics` | Reported as unsupported in first pass |
| `tool-trajectory` | Reported as unsupported in first pass |
| `cost` | Reported as unsupported in first pass |
| `latency` | Reported as unsupported in first pass |
| `trial-output-consistency` | Reported as unsupported in first pass |
| Other custom families | Reported as unsupported with the family name |

Unsupported does not block legacy fixture conversion unless
`--fail-on-unsupported` is set. The report keeps unsupported families visible so
parity gaps are explicit.
