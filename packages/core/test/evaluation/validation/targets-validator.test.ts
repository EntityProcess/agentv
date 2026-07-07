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
      `providers:
  - id: openrouter
    label: openrouter-target
    api_key: "{{ env.OPENROUTER_API_KEY }}"
    model: openai/gpt-5-mini
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(
      result.errors.some(
        (error) =>
          error.location === 'providers[0].id' &&
          error.message.includes("Unknown provider 'openrouter'"),
      ),
    ).toBe(false);
  });

  it('accepts Promptfoo-style colon provider specs', async () => {
    const filePath = path.join(tempDir, 'colon-provider-specs.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: openai:gpt-4.1-mini
    api_key: "{{ env.OPENAI_API_KEY }}"
  - id: openai:responses:gpt-5.4
    label: gpt5-responses
    api_key: "{{ env.OPENAI_API_KEY }}"
  - id: anthropic:messages:claude-sonnet-4-6
    api_key: "{{ env.ANTHROPIC_API_KEY }}"
  - id: exec:node ./provider.js
  - id: gateway:openai:responses:gpt-5.4
  - id: openai:codex
  - id: openai:codex-sdk:gpt-5.4-codex
    label: codex-sdk
  - id: openai:codex-app-server:gpt-5.4-codex
    label: codex-local
  - id: openai:codex-desktop
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'warning' &&
          (error.message.includes("Unknown provider 'openai:gpt") ||
            error.message.includes("Unknown provider 'anthropic:messages") ||
            error.message.includes("Unknown provider 'exec:node") ||
            error.message.includes("Unknown provider 'openai:codex")),
      ),
    ).toBe(false);
  });

  it('accepts label identity and config fields', async () => {
    const filePath = path.join(tempDir, 'promptfoo-shaped-target.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: agentv:codex-cli
    label: candidate-agent
    config:
      command: ["codex"]
      model: "{{ env.CODEX_MODEL }}"
      reasoning_effort: low
      base_url: "{{ env.OPENAI_BASE_URL }}"
      api_key: "{{ env.OPENAI_API_KEY }}"
      api_format: responses
    grader_target: grader
    fallback_targets: [backup-agent]
    batch_requests: true
  - id: openai
    label: grader
    config:
      api_key: "{{ env.OPENAI_API_KEY }}"
      model: gpt-5-mini
  - id: mock
    label: backup-agent
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
      `providers:
  - id: mock
    label: batch-cli
    provider_batching: true
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].provider_batching' &&
          error.message.includes("Use 'batch_requests' instead"),
      ),
    ).toBe(true);
  });

  it('rejects authored provider name in favor of id', async () => {
    const filePath = path.join(tempDir, 'legacy-name-target.yaml');
    await writeFile(
      filePath,
      `providers:
  - name: legacy-agent
    id: mock
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].id' &&
          error.message.includes("Missing or invalid 'id' field"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].name' &&
          error.message.includes("Use 'label'"),
      ),
    ).toBe(true);
  });

  it('rejects removed top-level targets in provider catalogs', async () => {
    const filePath = path.join(tempDir, 'top-level-providers.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: mock
    label: candidate-agent
targets:
  - id: candidate-agent
    provider: mock
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'targets' &&
          error.message.includes("Top-level 'targets' has been removed"),
      ),
    ).toBe(true);
  });

  it('warns on removed built-in provider aliases', async () => {
    const filePath = path.join(tempDir, 'removed-provider-aliases.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: azure-openai
    label: azure-alias
  - id: google
    label: google-alias
  - id: google-gemini
    label: google-gemini-alias
  - id: copilot
    label: copilot-alias
  - id: claude
    label: claude-alias
  - id: copilot_sdk
    label: copilot-sdk-alias
  - id: pi
    label: pi-alias
  - id: claude-code
    label: claude-code-alias
  - id: bedrock
    label: bedrock-future
  - id: vertex
    label: vertex-future
`,
    );

    const result = await validateTargetsFile(filePath);

    for (const provider of [
      'azure-openai',
      'google',
      'google-gemini',
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
            error.location.endsWith('.id') &&
            error.message.includes(`Unknown provider '${provider}'`),
        ),
      ).toBe(true);
    }

    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[3].id' &&
          error.message.includes("Ambiguous provider 'copilot'") &&
          error.message.includes('copilot-cli') &&
          error.message.includes('copilot-sdk'),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[4].id' &&
          error.message.includes("Ambiguous provider 'claude'") &&
          error.message.includes('claude-cli') &&
          error.message.includes('claude-sdk'),
      ),
    ).toBe(true);
  });

  it('rejects camelCase target aliases', async () => {
    const filePath = path.join(tempDir, 'camel-case-aliases.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: agentv:codex-cli
    label: codex-target
    command: ["codex"]
    timeoutSeconds: 30
    logDir: ./logs
    systemPrompt: Be precise.
    modelReasoningEffort: low
  - id: cli
    label: cli-target
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
          error.location === 'providers[0].timeoutSeconds' &&
          error.message.includes("Use 'timeout_seconds' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].logDir' &&
          error.message.includes("Use 'log_dir' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].systemPrompt' &&
          error.message.includes("Use 'system_prompt' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].modelReasoningEffort' &&
          error.message.includes("Use 'reasoning_effort' instead"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[1].healthcheck.timeoutSeconds' &&
          error.message.includes("Use 'timeout_seconds' instead"),
      ),
    ).toBe(true);
  });

  it('accepts codex reasoning_effort', async () => {
    const filePath = path.join(tempDir, 'codex-reasoning-effort.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: agentv:codex-cli
    label: codex-target
    command: ["codex"]
    model: "{{ env.CODEX_MODEL }}"
    reasoning_effort: "{{ env.CODEX_REASONING_EFFORT }}"
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
  });

  it('accepts flat provider fields on copilot SDK and CLI targets', async () => {
    const filePath = path.join(tempDir, 'copilot-flat-provider.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: copilot-sdk
    label: copilot-sdk-custom-provider
    model: gpt-5
    subprovider: openai
    base_url: "{{ env.OPENAI_ENDPOINT }}"
    api_key: "{{ env.OPENAI_API_KEY }}"
    api_format: responses
    model_id: gpt-5
    wire_model: "{{ env.OPENAI_MODEL }}"
  - id: copilot-cli
    label: copilot-cli-custom-provider
    subprovider: openai
    base_url: "{{ env.OPENAI_ENDPOINT }}"
    api_key: "{{ env.OPENAI_API_KEY }}"
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
      `providers:
  - id: agentv:codex-cli
    label: codex-local-openai
    command: ["codex"]
    model: "{{ env.CODEX_MODEL }}"
    reasoning_effort: medium
    model_verbosity: medium
    base_url: "{{ env.OPENAI_ENDPOINT }}"
    api_key: "{{ env.OPENAI_API_KEY }}"
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
      `providers:
  - id: copilot-sdk
    label: copilot-sdk-custom
    custom_provider:
      type: openai
      base_url: "{{ env.OPENAI_ENDPOINT }}"
      api_key: "{{ env.OPENAI_API_KEY }}"
  - id: copilot-sdk
    label: copilot-sdk-byok
    byok:
      type: openai
      base_url: "{{ env.OPENAI_ENDPOINT }}"
      api_key: "{{ env.OPENAI_API_KEY }}"
  - id: copilot-cli
    label: copilot-cli-custom
    custom_provider:
      type: openai
      base_url: "{{ env.OPENAI_ENDPOINT }}"
      api_key: "{{ env.OPENAI_API_KEY }}"
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

  it('rejects use_target on authored provider definitions', async () => {
    const filePath = path.join(tempDir, 'templated-use-target.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: mock
    label: default
    use_target: "{{ env.AGENT_TARGET }}"
  - id: mock
    label: grader
    use_target: "{{ env.GRADER_TARGET }}"
  - id: agentv:codex-cli
    label: codex-agent
    command: ["codex"]
    grader_target: grader
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'providers[0].use_target',
        message: expect.stringContaining("'use_target' field has been removed"),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'providers[1].use_target',
        message: expect.stringContaining("'use_target' field has been removed"),
      }),
    );
  });

  it('rejects legacy env interpolation in provider YAML', async () => {
    const filePath = path.join(tempDir, 'legacy-env-target.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: openai
    label: openai-target
    api_key: \${{ OPENAI_API_KEY }}
    model: gpt-5-mini
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        location: 'providers[0].api_key',
        message: expect.stringContaining('Use {{ env.OPENAI_API_KEY }} instead'),
      }),
    );
  });

  it('rejects removed judge_target alias', async () => {
    const filePath = path.join(tempDir, 'judge-target-alias.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: agentv:codex-cli
    label: codex-agent
    command: ["codex"]
    model: gpt-5
    judge_target: grader
  - id: openai
    label: grader
    model: gpt-5-mini
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].judge_target' &&
          error.message.includes("'judge_target' field has been removed"),
      ),
    ).toBe(true);
  });

  it('rejects removed log_format target aliases', async () => {
    const filePath = path.join(tempDir, 'log-format-aliases.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: copilot-cli
    label: copilot-agent
    log_format: json
  - id: claude-cli
    label: claude-agent
    log_output_format: summary
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].log_format' &&
          error.message.includes("Use 'stream_log: raw'"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[1].log_output_format' &&
          error.message.includes("Use 'stream_log: raw'"),
      ),
    ).toBe(true);
  });

  it('rejects azure api_format with a removed-field error', async () => {
    const filePath = path.join(tempDir, 'azure-api-format.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: azure
    label: azure-responses
    endpoint: "{{ env.AZURE_OPENAI_ENDPOINT }}"
    api_key: "{{ env.AZURE_OPENAI_API_KEY }}"
    model: "{{ env.AZURE_DEPLOYMENT_NAME }}"
    api_format: responses
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(
      result.errors.some(
        (error) =>
          error.severity === 'error' &&
          error.location === 'providers[0].api_format' &&
          /'api_format' field has been removed/i.test(error.message),
      ),
    ).toBe(true);
  });

  it('accepts replay targets backed by execution traces', async () => {
    const filePath = path.join(tempDir, 'replay-execution-traces.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: replay
    label: replay-execution-trace
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

  it('accepts replay targets backed by normalized transcripts', async () => {
    const filePath = path.join(tempDir, 'replay-transcripts.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: replay
    label: replay-transcript
    transcripts: ./fixtures/transcript.jsonl
    source_target: live-agent
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some((error) => error.message.includes("Unknown setting 'transcripts'")),
    ).toBe(false);
  });

  it('rejects replay targets with ambiguous source configuration', async () => {
    const filePath = path.join(tempDir, 'replay-ambiguous-source.yaml');
    await writeFile(
      filePath,
      `providers:
  - id: replay
    label: replay-ambiguous
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
          error.location === 'providers[0]' &&
          /exactly one replay source/i.test(error.message),
      ),
    ).toBe(true);
  });
});
