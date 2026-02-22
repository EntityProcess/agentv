import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, positional, string } from 'cmd-ts';

const ASSERTION_TEMPLATE = `#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => {
  // TODO: Implement your assertion logic
  const pass = answer.length > 0;
  return {
    pass,
    reasoning: pass ? 'Output has content' : 'Output is empty',
  };
});
`;

const EVAL_TEMPLATE = (name: string) => `description: ${name} evaluation suite
execution:
  target: default

tests:
  - id: sample-test
    criteria: Agent responds correctly
    input: "Hello, how are you?"
    expected_output: "I'm doing well"
    assert:
      - type: contains
        value: "well"
`;

const EVAL_CASES_TEMPLATE = `{"id":"case-1","criteria":"Responds helpfully","input":"What is 2+2?","expected_output":"4"}
`;

export const createAssertionCommand = command({
  name: 'assertion',
  description: 'Create a custom assertion scaffold',
  args: {
    name: positional({
      type: string,
      displayName: 'name',
      description: 'Name of the assertion (e.g., sentiment)',
    }),
  },
  handler: async ({ name }) => {
    const dir = path.join(process.cwd(), '.agentv', 'assertions');
    const filePath = path.join(dir, `${name}.ts`);

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, ASSERTION_TEMPLATE);
    console.log(`Created ${path.relative(process.cwd(), filePath)}`);
    console.log(`\nUse in EVAL.yaml:\n  assert:\n    - type: ${name}`);
  },
});

export const createEvalCommand = command({
  name: 'eval',
  description: 'Create an eval suite scaffold',
  args: {
    name: positional({
      type: string,
      displayName: 'name',
      description: 'Name of the eval suite (e.g., my-agent)',
    }),
  },
  handler: async ({ name }) => {
    const dir = path.join(process.cwd(), 'evals');
    const yamlPath = path.join(dir, `${name}.eval.yaml`);
    const casesPath = path.join(dir, `${name}.cases.jsonl`);

    await mkdir(dir, { recursive: true });
    await writeFile(yamlPath, EVAL_TEMPLATE(name));
    await writeFile(casesPath, EVAL_CASES_TEMPLATE);
    console.log(`Created ${path.relative(process.cwd(), yamlPath)}`);
    console.log(`Created ${path.relative(process.cwd(), casesPath)}`);
    console.log(`\nRun with:\n  agentv eval ${path.relative(process.cwd(), yamlPath)}`);
  },
});
