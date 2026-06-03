# Phoenix Adapter Support Matrix

This workspace converts AgentV example evals into Phoenix dataset and experiment payloads.

For observing real AgentV eval runs in Phoenix, use the core OTel preset:

```bash
agentv eval evals/my-eval.yaml --export-otel --otel-backend phoenix
```

The adapter remains repo-local/private until real AgentV execution and broader scorer parity are complete.

| AgentV family | Phoenix adapter status |
| --- | --- |
| `contains` | Supported by deterministic adapter |
| `regex` | Supported by deterministic adapter |
| `equals` | Supported by deterministic adapter |
| `is-json` | Supported by deterministic adapter |
| `contains-any`, `contains-all`, `icontains`, `icontains-any`, `icontains-all`, `starts-with`, `ends-with` | Planned deterministic parity work |
| `llm-grader`, `rubrics` | Unsupported until AgentV-authoritative LLM/rubric scoring is wired into Phoenix experiment evaluation |
| `code-grader` | Unsupported until adapter runs real AgentV execution and code-grader context |
| `composite`, `field-accuracy`, `trial-output-consistency` | Unsupported until composed scorer semantics are mapped without changing AgentV scoring authority |
| `execution-metrics`, `tool-trajectory`, `cost`, `latency` | Unsupported until Phoenix trace IDs/spans can be associated with AgentV test cases |
| Other custom families | Reported as unsupported with the family name |

Unsupported does not block conversion unless `--fail-on-unsupported` is set. The report keeps unsupported families visible so parity gaps are explicit.
