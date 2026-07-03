import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateTargetsFile } from '../../../src/evaluation/validation/targets-validator.js';

describe('validateTargetsFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-targets-validator-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts openrouter as a known provider', async () => {
    const filePath = path.join(tempDir, 'openrouter-target.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: openrouter-target
    provider: openrouter
    api_key: \${{ OPENROUTER_API_KEY }}
    model: openai/gpt-5-mini
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(
      result.errors.some(
        (error) =>
          error.location === 'targets[0].provider' &&
          error.message.includes("Unknown provider 'openrouter'"),
      ),
    ).toBe(false);
  });

  it('accepts promptfoo-shaped id, label, and config fields', async () => {
    const filePath = path.join(tempDir, 'promptfoo-shaped-target.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: candidate-agent
    id: openai:gpt-5-codex
    provider: codex-cli
    config:
      command: ["codex"]
      model: \${{ CODEX_MODEL }}
      reasoning_effort: low
      base_url: \${{ OPENAI_BASE_URL }}
      api_key: \${{ OPENAI_API_KEY }}
      api_format: responses
    grader_target: grader
    fallback_targets: [backup-agent]
    batch_requests: true
  - label: grader
    provider: openai
    config:
      api_key: \${{ OPENAI_API_KEY }}
      model: gpt-5-mini
  - label: backup-agent
    provider: mock
    config:
      response: backup
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors.filter((error) => error.severity === 'warning')).toEqual([]);
  });

  it('rejects removed provider_batching in favor of batch_requests', async () => {
    const filePath = path.join(tempDir, 'removed-provider-batching.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: batch-cli
    provider: mock
    provider_batching: true
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].provider_batching' &&
          error.message.includes("Use 'batch_requests' instead"),
      ),
    ).toBe(true);
  });

  it('rejects authored target name in favor of label', async () => {
    const filePath = path.join(tempDir, 'legacy-name-target.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: legacy-agent
    provider: mock
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].label' &&
          error.message.includes("Missing or invalid 'label' field"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].name' &&
          error.message.includes("Use 'label'"),
      ),
    ).toBe(true);
  });

  it('rejects top-level providers as a targets.yaml runtime alias', async () => {
    const filePath = path.join(tempDir, 'top-level-providers.yaml');
    await writeFile(
      filePath,
      `providers:
  - label: candidate-agent
    provider: mock
targets:
  - label: candidate-agent
    provider: mock
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers' &&
          error.message.includes("Top-level 'providers' is not a runtime alias"),
      ),
    ).toBe(true);
  });

  it('warns on removed built-in provider aliases', async () => {
    const filePath = path.join(tempDir, 'removed-provider-aliases.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: azure-alias
    provider: azure-openai
  - label: google-alias
    provider: google
  - label: google-gemini-alias
    provider: google-gemini
  - label: copilot-alias
    provider: copilot
  - label: copilot-sdk-alias
    provider: copilot_sdk
  - label: pi-alias
    provider: pi
  - label: claude-code-alias
    provider: claude-code
  - label: bedrock-future
    provider: bedrock
  - label: vertex-future
    provider: vertex
`,
    );

    const result = await validateTargetsFile(filePath);

    for (const provider of [
      'azure-openai',
      'google',
      'google-gemini',
      'copilot',
      'copilot_sdk',
      'pi',
      'claude-code',
      'bedrock',
      'vertex',
    ]) {
      expect(
        result.errors.some(
          (error) =>
            error.severity === 'warning' &&
            error.location.endsWith('.provider') &&
            error.message.includes(`Unknown provider '${provider}'`),
        ),
      ).toBe(true);
    }
  });

  it('rejects camelCase target aliases', async () => {
    const filePath = path.join(tempDir, 'camel-case-aliases.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: codex-target
    provider: codex-cli
    command: ["codex"]
    timeoutSeconds: 30
    logDir: ./logs
    systemPrompt: Be precise.
    modelReasoningEffort: low
  - label: cli-target
    provider: cli
    command: echo {PROMPT}
    healthcheck:
      command: echo ok
      timeoutSeconds: 5
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].timeoutSeconds' &&
          error.message.includes("Use 'timeout_seconds' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].logDir' &&
          error.message.includes("Use 'log_dir' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].systemPrompt' &&
          error.message.includes("Use 'system_prompt' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].modelReasoningEffort' &&
          error.message.includes("Use 'reasoning_effort' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[1].healthcheck.timeoutSeconds' &&
          error.message.includes("Use 'timeout_seconds' instead"),
      ),
    ).toBe(true);
  });

  it('accepts codex reasoning_effort', async () => {
    const filePath = path.join(tempDir, 'codex-reasoning-effort.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: codex-target
    provider: codex-cli
    command: ["codex"]
    model: \${{ CODEX_MODEL }}
    reasoning_effort: \${{ CODEX_REASONING_EFFORT }}
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
  });

  it('accepts flat provider fields on copilot SDK and CLI targets', async () => {
    const filePath = path.join(tempDir, 'copilot-flat-provider.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: copilot-sdk-custom-provider
    provider: copilot-sdk
    model: gpt-5
    subprovider: openai
    base_url: \${{ OPENAI_ENDPOINT }}
    api_key: \${{ OPENAI_API_KEY }}
    api_format: responses
    model_id: gpt-5
    wire_model: \${{ OPENAI_MODEL }}
  - label: copilot-cli-custom-provider
    provider: copilot-cli
    subprovider: openai
    base_url: \${{ OPENAI_ENDPOINT }}
    api_key: \${{ OPENAI_API_KEY }}
    api_format: responses
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors.filter((error) => error.severity === 'warning')).toEqual([]);
  });

  it('accepts OpenAI-compatible endpoint fields on codex targets', async () => {
    const filePath = path.join(tempDir, 'codex-openai-provider.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: codex-local-openai
    provider: codex-cli
    command: ["codex"]
    model: \${{ CODEX_MODEL }}
    reasoning_effort: medium
    model_verbosity: medium
    base_url: \${{ OPENAI_ENDPOINT }}
    api_key: \${{ OPENAI_API_KEY }}
    api_format: responses
    sandbox_mode: danger-full-access
    approval_policy: never
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors.filter((error) => error.severity === 'warning')).toEqual([]);
  });

  it('warns on removed copilot custom_provider and byok fields', async () => {
    const filePath = path.join(tempDir, 'copilot-removed-provider-fields.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: copilot-sdk-custom
    provider: copilot-sdk
    custom_provider:
      type: openai
      base_url: \${{ OPENAI_ENDPOINT }}
      api_key: \${{ OPENAI_API_KEY }}
  - label: copilot-sdk-byok
    provider: copilot-sdk
    byok:
      type: openai
      base_url: \${{ OPENAI_ENDPOINT }}
      api_key: \${{ OPENAI_API_KEY }}
  - label: copilot-cli-custom
    provider: copilot-cli
    custom_provider:
      type: openai
      base_url: \${{ OPENAI_ENDPOINT }}
      api_key: \${{ OPENAI_API_KEY }}
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(
      result.errors.some(
        (error) =>
          error.severity === 'warning' &&
          error.message.includes("Unknown setting 'custom_provider'"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) => error.severity === 'warning' && error.message.includes("Unknown setting 'byok'"),
      ),
    ).toBe(true);
  });

  it('accepts env-templated use_target values without resolving the env during validation', async () => {
    const filePath = path.join(tempDir, 'templated-use-target.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: default
    use_target: \${{ AGENT_TARGET }}
  - label: grader
    use_target: \${{ GRADER_TARGET }}
  - label: codex-agent
    provider: codex-cli
    command: ["codex"]
    grader_target: grader
`,
    );

    const originalAgentTarget = process.env.AGENT_TARGET;
    const originalGraderTarget = process.env.GRADER_TARGET;
    Reflect.deleteProperty(process.env, 'AGENT_TARGET');
    Reflect.deleteProperty(process.env, 'GRADER_TARGET');

    try {
      const result = await validateTargetsFile(filePath);

      expect(result.valid).toBe(true);
      expect(
        result.errors.some(
          (error) =>
            error.severity === 'error' &&
            error.message.includes("Missing or invalid 'provider' field"),
        ),
      ).toBe(false);
    } finally {
      if (originalAgentTarget === undefined) {
        Reflect.deleteProperty(process.env, 'AGENT_TARGET');
      } else {
        process.env.AGENT_TARGET = originalAgentTarget;
      }
      if (originalGraderTarget === undefined) {
        Reflect.deleteProperty(process.env, 'GRADER_TARGET');
      } else {
        process.env.GRADER_TARGET = originalGraderTarget;
      }
    }
  });

  it('rejects removed judge_target alias', async () => {
    const filePath = path.join(tempDir, 'judge-target-alias.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: codex-agent
    provider: codex-cli
    command: ["codex"]
    model: gpt-5
    judge_target: grader
  - label: grader
    provider: openai
    model: gpt-5-mini
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].judge_target' &&
          error.message.includes("'judge_target' field has been removed"),
      ),
    ).toBe(true);
  });

  it('rejects removed log_format target aliases', async () => {
    const filePath = path.join(tempDir, 'log-format-aliases.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: copilot-agent
    provider: copilot-cli
    log_format: json
  - label: claude-agent
    provider: claude
    log_output_format: summary
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].log_format' &&
          error.message.includes("Use 'stream_log: raw'"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[1].log_output_format' &&
          error.message.includes("Use 'stream_log: raw'"),
      ),
    ).toBe(true);
  });

  it('rejects azure api_format with a removed-field error', async () => {
    const filePath = path.join(tempDir, 'azure-api-format.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: azure-responses
    provider: azure
    endpoint: \${{ AZURE_OPENAI_ENDPOINT }}
    api_key: \${{ AZURE_OPENAI_API_KEY }}
    model: \${{ AZURE_DEPLOYMENT_NAME }}
    api_format: responses
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0].api_format' &&
          /'api_format' field has been removed/i.test(error.message),
      ),
    ).toBe(true);
  });

  it('accepts replay targets backed by execution traces', async () => {
    const filePath = path.join(tempDir, 'replay-execution-traces.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: replay-execution-trace
    provider: replay
    execution_traces: ./fixtures/execution-traces.jsonl
    source_target: live-agent
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some((error) => error.message.includes("Unknown setting 'execution_traces'")),
    ).toBe(false);
  });

  it('rejects replay targets with ambiguous source configuration', async () => {
    const filePath = path.join(tempDir, 'replay-ambiguous-source.yaml');
    await writeFile(
      filePath,
      `targets:
  - label: replay-ambiguous
    provider: replay
    fixtures: ./fixtures/target-output.jsonl
    execution_traces: ./fixtures/execution-traces.jsonl
    source_target: live-agent
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets[0]' &&
          /exactly one replay source/i.test(error.message),
      ),
    ).toBe(true);
  });
});
