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
  - name: openrouter-target
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

  it('rejects camelCase target aliases', async () => {
    const filePath = path.join(tempDir, 'camel-case-aliases.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: codex-target
    provider: codex
    timeoutSeconds: 30
    logDir: ./logs
    systemPrompt: Be precise.
    modelReasoningEffort: low
  - name: cli-target
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
          error.message.includes("Use 'model_reasoning_effort' instead"),
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

  it('accepts codex model_reasoning_effort', async () => {
    const filePath = path.join(tempDir, 'codex-reasoning-effort.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: codex-target
    provider: codex
    model: \${{ CODEX_MODEL }}
    model_reasoning_effort: \${{ CODEX_REASONING_EFFORT }}
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
  - name: copilot-sdk-custom-provider
    provider: copilot-sdk
    subprovider: openai
    base_url: \${{ OPENAI_ENDPOINT }}
    api_key: \${{ OPENAI_API_KEY }}
    wire_api: responses
  - name: copilot-cli-custom-provider
    provider: copilot-cli
    subprovider: openai
    base_url: \${{ OPENAI_ENDPOINT }}
    api_key: \${{ OPENAI_API_KEY }}
    wire_api: responses
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
  - name: copilot-sdk-custom
    provider: copilot-sdk
    custom_provider:
      type: openai
      base_url: \${{ OPENAI_ENDPOINT }}
      api_key: \${{ OPENAI_API_KEY }}
  - name: copilot-sdk-byok
    provider: copilot-sdk
    byok:
      type: openai
      base_url: \${{ OPENAI_ENDPOINT }}
      api_key: \${{ OPENAI_API_KEY }}
  - name: copilot-cli-custom
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
  - name: default
    use_target: \${{ AGENT_TARGET }}
  - name: grader
    use_target: \${{ GRADER_TARGET }}
  - name: codex-agent
    provider: codex
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

  it('rejects azure api_format with a migration error', async () => {
    const filePath = path.join(tempDir, 'azure-api-format.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: azure-responses
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
          /'api_format' field is no longer supported/i.test(error.message),
      ),
    ).toBe(true);
  });

  it('accepts replay targets backed by trace envelopes', async () => {
    const filePath = path.join(tempDir, 'replay-trace-envelopes.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: replay-envelope
    provider: replay
    trace_envelopes: ./fixtures/trace-envelopes.jsonl
    source_target: live-agent
`,
    );

    const result = await validateTargetsFile(filePath);

    expect(result.valid).toBe(true);
    expect(
      result.errors.some((error) => error.message.includes("Unknown setting 'trace_envelopes'")),
    ).toBe(false);
  });

  it('rejects replay targets with ambiguous source configuration', async () => {
    const filePath = path.join(tempDir, 'replay-ambiguous-source.yaml');
    await writeFile(
      filePath,
      `targets:
  - name: replay-ambiguous
    provider: replay
    fixtures: ./fixtures/target-output.jsonl
    trace_envelopes: ./fixtures/trace-envelopes.jsonl
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
