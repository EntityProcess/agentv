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
});
