import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateEvalFile } from '../../../src/evaluation/validation/eval-validator.js';

describe('validateEvalFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = path.join(os.tmpdir(), `agentv-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('tool_calls validation', () => {
    it('accepts valid tool_calls in assistant messages', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
    expected_messages:
      - role: assistant
        content: "Let me search for X"
        tool_calls:
          - tool: knowledgeSearch
            input: { query: "X configuration" }
          - tool: getWeather
            input: { city: "NYC" }
            output: "72°F"
`;
      const filePath = path.join(tempDir, 'valid-tool-calls.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects tool_calls on non-assistant messages', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
        tool_calls:
          - tool: knowledgeSearch
`;
      const filePath = path.join(tempDir, 'tool-calls-on-user.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes('tool_calls can only be specified on assistant messages'),
        ),
      ).toBe(true);
    });

    it('rejects tool_calls that is not an array', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
    expected_messages:
      - role: assistant
        content: "Searching..."
        tool_calls: "not an array"
`;
      const filePath = path.join(tempDir, 'tool-calls-not-array.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('tool_calls must be an array'))).toBe(
        true,
      );
    });

    it('rejects tool_call without tool field', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
    expected_messages:
      - role: assistant
        content: "Searching..."
        tool_calls:
          - input: { query: "X" }
`;
      const filePath = path.join(tempDir, 'tool-call-missing-tool.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid 'tool' field"))).toBe(
        true,
      );
    });

    it('rejects tool_call with empty tool name', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
    expected_messages:
      - role: assistant
        content: "Searching..."
        tool_calls:
          - tool: ""
            input: { query: "X" }
`;
      const filePath = path.join(tempDir, 'tool-call-empty-tool.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid 'tool' field"))).toBe(
        true,
      );
    });

    it('accepts tool_calls with only tool field (input/output optional)', async () => {
      const content = `
schema: agentv-eval-v2
evalcases:
  - id: test-case
    input_messages:
      - role: user
        content: "Search for X"
    expected_messages:
      - role: assistant
        content: "Searching..."
        tool_calls:
          - tool: knowledgeSearch
`;
      const filePath = path.join(tempDir, 'tool-call-minimal.yaml');
      await writeFile(filePath, content);

      const result = await validateEvalFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
