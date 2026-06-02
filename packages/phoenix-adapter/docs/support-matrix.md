# Phoenix Adapter Support Matrix

This workspace converts AgentV example evals into Phoenix dataset and experiment payloads.

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

Unsupported does not block conversion unless `--fail-on-unsupported` is set. The report keeps unsupported families visible so parity gaps are explicit.
