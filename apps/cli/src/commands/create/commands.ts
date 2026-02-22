import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command, option, optional, positional, string } from 'cmd-ts';

const ASSERTION_TEMPLATES: Record<string, string> = {
  default: `#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => {
  // TODO: Implement your assertion logic
  const pass = answer.length > 0;
  return {
    pass,
    reasoning: pass ? 'Output has content' : 'Output is empty',
  };
});
`,
  score: `#!/usr/bin/env bun
import { defineAssertion } from '@agentv/eval';

export default defineAssertion(({ answer }) => {
  // TODO: Implement your scoring logic (0.0 to 1.0)
  const score = answer.length > 0 ? 1.0 : 0.0;
  return {
    pass: score >= 0.5,
    score,
    reasoning: \`Score: \${score}\`,
  };
});
`,
};

const EVAL_TEMPLATES: Record<string, (name: string) => string> = {
  default: (name: string) => `description: ${name} evaluation suite
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
`,
  rubric: (name: string) => `description: ${name} evaluation suite
execution:
  target: default

tests:
  - id: sample-test
    criteria: Agent responds correctly and completely
    input: "Hello, how are you?"
    expected_output: "I'm doing well, thank you for asking!"
    assert:
      - type: llm_judge
        rubric:
          accuracy:
            weight: 0.6
            criteria: Response is factually correct
          completeness:
            weight: 0.4
            criteria: Response addresses all parts of the question
`,
};

const PROVIDER_TEMPLATE = `#!/usr/bin/env bun
/**
 * Custom provider scaffold.
 *
 * AgentV providers are configured via .agentv/targets.yaml using the CLI provider:
 *
 *   targets:
 *     - name: my-target
 *       provider: cli
 *       command_template: "bun run .agentv/providers/<name>.ts {PROMPT}"
 *
 * This script receives the prompt as a CLI argument and prints the response to stdout.
 */

const prompt = process.argv[2];

if (!prompt) {
  console.error('Usage: bun run provider.ts "<prompt>"');
  process.exit(1);
}

// TODO: Replace with your LLM API call or custom logic
const response = \`Echo: \${prompt}\`;

console.log(response);
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
    template: option({
      type: optional(string),
      long: 'template',
      description: `Template variant (${Object.keys(ASSERTION_TEMPLATES).join(', ')})`,
    }),
  },
  handler: async ({ name, template }) => {
    const templateName = template ?? 'default';
    const content = ASSERTION_TEMPLATES[templateName];
    if (!content) {
      console.error(
        `Unknown template "${templateName}". Available: ${Object.keys(ASSERTION_TEMPLATES).join(', ')}`,
      );
      process.exit(1);
    }

    const dir = path.join(process.cwd(), '.agentv', 'assertions');
    const filePath = path.join(dir, `${name}.ts`);

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content);
    console.log(`Created ${path.relative(process.cwd(), filePath)} (template: ${templateName})`);
    console.log(`\nUse in EVAL.yaml:\n  assert:\n    - type: ${name}`);
  },
});

export const createProviderCommand = command({
  name: 'provider',
  description: 'Create a custom provider scaffold',
  args: {
    name: positional({
      type: string,
      displayName: 'name',
      description: 'Name of the provider (e.g., my-llm)',
    }),
    template: option({
      type: optional(string),
      long: 'template',
      description: 'Template variant (default)',
    }),
  },
  handler: async ({ name, template }) => {
    const templateName = template ?? 'default';
    if (templateName !== 'default') {
      console.error(`Unknown template "${templateName}". Available: default`);
      process.exit(1);
    }

    const dir = path.join(process.cwd(), '.agentv', 'providers');
    const filePath = path.join(dir, `${name}.ts`);

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, PROVIDER_TEMPLATE);
    console.log(`Created ${path.relative(process.cwd(), filePath)} (template: ${templateName})`);
    console.log(
      `\nConfigure in .agentv/targets.yaml:\n  targets:\n    - name: ${name}\n      provider: cli\n      command_template: "bun run .agentv/providers/${name}.ts {PROMPT}"`,
    );
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
    template: option({
      type: optional(string),
      long: 'template',
      description: `Template variant (${Object.keys(EVAL_TEMPLATES).join(', ')})`,
    }),
  },
  handler: async ({ name, template }) => {
    const templateName = template ?? 'default';
    const templateFn = EVAL_TEMPLATES[templateName];
    if (!templateFn) {
      console.error(
        `Unknown template "${templateName}". Available: ${Object.keys(EVAL_TEMPLATES).join(', ')}`,
      );
      process.exit(1);
    }

    const dir = path.join(process.cwd(), 'evals');
    const yamlPath = path.join(dir, `${name}.eval.yaml`);
    const casesPath = path.join(dir, `${name}.cases.jsonl`);

    await mkdir(dir, { recursive: true });
    await writeFile(yamlPath, templateFn(name));
    await writeFile(casesPath, EVAL_CASES_TEMPLATE);
    console.log(`Created ${path.relative(process.cwd(), yamlPath)} (template: ${templateName})`);
    console.log(`Created ${path.relative(process.cwd(), casesPath)}`);
    console.log(`\nRun with:\n  agentv eval ${path.relative(process.cwd(), yamlPath)}`);
  },
});
