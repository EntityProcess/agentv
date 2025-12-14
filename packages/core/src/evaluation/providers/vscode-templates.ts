/**
 * Custom request templates for AgentV evaluation workflows
 * These templates are used when dispatching to VSCode via subagent
 */

export const AGENTV_REQUEST_TEMPLATE = `[[ ## task ## ]]

{{userQuery}}

[[ ## system_instructions ## ]]

**IMPORTANT**: Follow these exact steps:
1. Create and write your complete response to: {{responseFileTmp}}
    - Do NOT create any additional output files in the workspace.
    - All intended file outputs/changes MUST be written in your response file.
    - For each intended file, include the repo name, relative path and unified git diff following the convention \`diff --git ...\`.
2. When completely finished, run these PowerShell commands to signal completion:
\`\`\`
Move-Item -LiteralPath '{{responseFileTmp}}' -Destination '{{responseFileFinal}}'
if (Test-Path subagent.lock) { del subagent.lock }
\`\`\`

Do not proceed to step 2 until your response is completely written to the temporary file.
`;

export const AGENTV_BATCH_REQUEST_TEMPLATE = `[[ ## task ## ]]

{{userQuery}}

[[ ## system_instructions ## ]]

**IMPORTANT**: Follow these exact steps:
1. Create and write your complete response to: {{responseFileTmp}}
    - Do NOT create any additional output files in the workspace.
    - All intended file outputs/changes MUST be written in your response file.
    - For each intended file, include the repo name, relative path and unified git diff following the convention \`diff --git ...\`.
2. When completely finished and the response is stable, rename it to: {{responseFileFinal}}
3. Do not unlock the workspace from this request; batch orchestration will handle unlocking after all responses are ready.
`;

export const AGENTV_BATCH_ORCHESTRATOR_TEMPLATE = `MANDATORY: Run #runSubagent tool in your Available Actions for each request file to process them in isolated contexts.
DO NOT read the request files yourself - only pass the file paths to each subagent:

{{requestFiles}}

After ALL queries complete, verify all responses exist and unlock:

\`\`\`powershell
$responses = @({{responseList}})
$missing = $responses | Where-Object { -not (Test-Path "messages/$_") }
if ($missing.Count -eq 0) { del subagent.lock }
\`\`\`
`;
