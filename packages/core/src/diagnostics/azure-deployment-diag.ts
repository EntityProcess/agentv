#!/usr/bin/env node
import process from 'node:process';

interface ProbeResult {
  readonly label: string;
  readonly status: number | 'error';
  readonly ok: boolean;
  readonly bodyPreview?: string;
  readonly errorMessage?: string;
}

const endpoint = normalizeEndpoint(process.env.AZURE_OPENAI_ENDPOINT);
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const preferredDeployment = process.env.AZURE_DEPLOYMENT_NAME;

if (!endpoint) {
  console.error('AZURE_OPENAI_ENDPOINT is not defined.');
  process.exitCode = 1;
  process.exit();
}

if (!apiKey) {
  console.error('AZURE_OPENAI_API_KEY is not defined.');
  process.exitCode = 1;
  process.exit();
}

const versionsToTest = [
  '2024-10-01-preview',
  '2024-08-01-preview',
  '2024-07-01-preview',
  '2024-06-01-preview',
  '2024-05-01-preview',
  '2024-04-01-preview',
  '2024-03-01-preview',
  '2024-02-15-preview',
  '2023-12-01-preview',
];

const deploymentCandidates = buildDeploymentCandidates(preferredDeployment);

console.log('Azure OpenAI diagnostics');
console.log('Endpoint:', endpoint);
console.log('API key suffix:', apiKey.slice(-4));
console.log('Candidate deployments:', deploymentCandidates.join(', '));
console.log('');

await probeDeploymentsList();
console.log('');
await probeChatCompletions();

async function probeDeploymentsList(): Promise<void> {
  console.log('Checking deployments endpoint across API versions...');
  for (const version of versionsToTest) {
    const url = `${endpoint}openai/deployments?api-version=${version}`;
    const result = await fetchWithDiagnostics(url, {
      method: 'GET',
      headers: buildHeaders(),
    });

    logProbeResult(`GET deployments (api-version=${version})`, result);

    if (result.ok) {
      return;
    }
  }
}

async function probeChatCompletions(): Promise<void> {
  console.log('Testing chat completions across deployments and API versions...');

  for (const deployment of deploymentCandidates) {
    for (const version of versionsToTest) {
      const url = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${version}`;
      const result = await fetchWithDiagnostics(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
        }),
      });

      logProbeResult(
        `POST chat/completions (deployment=${deployment}, api-version=${version})`,
        result,
      );

      if (result.ok) {
        return;
      }
    }
  }
}

type FetchOptions = Parameters<typeof fetch>[1];

async function fetchWithDiagnostics(url: string, options: FetchOptions): Promise<ProbeResult> {
  try {
    const response = await fetch(url, options);
    const bodyText = await response.text();
    return {
      label: url,
      status: response.status,
      ok: response.ok,
      bodyPreview: bodyText.slice(0, 400),
    };
  } catch (error) {
    return {
      label: url,
      status: 'error',
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function logProbeResult(action: string, result: ProbeResult): void {
  if (result.ok) {
    console.log(`✅ ${action} -> ${String(result.status)}`);
  } else if (result.status === 'error') {
    console.log(`❌ ${action} -> network error: ${result.errorMessage}`);
  } else {
    console.log(`❌ ${action} -> HTTP ${result.status}`);
    if (result.bodyPreview) {
      console.log(indent(result.bodyPreview));
    }
  }
}

function buildHeaders(): Record<string, string> {
  if (!apiKey) {
    throw new Error('API key is required');
  }
  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  };
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function buildDeploymentCandidates(primary?: string): string[] {
  const defaults = ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-chat', 'gpt-5-mini'];
  const unique = new Set<string>();
  if (primary && primary.trim().length > 0) {
    unique.add(primary.trim());
  }
  for (const name of defaults) {
    unique.add(name);
  }
  return Array.from(unique);
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
}
