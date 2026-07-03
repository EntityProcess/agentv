#!/usr/bin/env node
import {
  SDK_CHILD_PROTOCOL_VERSION,
  type SdkChildErrorWire,
  type SdkChildProviderKind,
  type SdkChildRequestEnvelope,
  providerRequestFromWire,
  providerResponseToWire,
  writeSdkChildEnvelope,
} from './sdk-child-protocol.js';
import type { Provider, ProviderResponse } from './types.js';

async function main(): Promise<void> {
  const input = await readStdin();
  const envelope = parseRequest(input);

  writeSdkChildEnvelope({
    protocol_version: SDK_CHILD_PROTOCOL_VERSION,
    type: 'event',
    event: {
      kind: 'lifecycle',
      message: `starting ${envelope.provider_kind} child runner`,
    },
  });

  const provider = await createChildProvider(
    envelope.provider_kind,
    envelope.target_name,
    envelope.config,
  );
  const restoreConsole = installConsoleProtocolBridge();
  let response: ProviderResponse;
  try {
    response = await provider.invoke(providerRequestFromWire(envelope.request));
  } finally {
    restoreConsole();
  }

  writeSdkChildEnvelope({
    protocol_version: SDK_CHILD_PROTOCOL_VERSION,
    type: 'result',
    response: providerResponseToWire(response),
  });
}

function parseRequest(input: string): SdkChildRequestEnvelope {
  const parsed = JSON.parse(input) as SdkChildRequestEnvelope;
  if (parsed.protocol_version !== SDK_CHILD_PROTOCOL_VERSION) {
    throw new Error(`Unsupported SDK child protocol version: ${String(parsed.protocol_version)}`);
  }
  if (!isSdkChildProviderKind(parsed.provider_kind)) {
    throw new Error(`Unsupported SDK child provider: ${String(parsed.provider_kind)}`);
  }
  if (typeof parsed.target_name !== 'string' || parsed.target_name.trim().length === 0) {
    throw new Error('SDK child request target_name is required');
  }
  return parsed;
}

async function createChildProvider(
  kind: SdkChildProviderKind,
  targetName: string,
  config: unknown,
): Promise<Provider> {
  switch (kind) {
    case 'codex-sdk': {
      const { CodexProvider } = await import('./codex.js');
      return new CodexProvider(targetName, config as never);
    }
    case 'claude-sdk': {
      const { ClaudeSdkProvider } = await import('./claude-sdk.js');
      return new ClaudeSdkProvider(targetName, config as never);
    }
    case 'copilot-sdk': {
      const { CopilotSdkProvider } = await import('./copilot-sdk.js');
      return new CopilotSdkProvider(targetName, config as never);
    }
    case 'pi-sdk': {
      const { PiCodingAgentProvider } = await import('./pi-coding-agent.js');
      return new PiCodingAgentProvider(targetName, config as never);
    }
  }
}

function isSdkChildProviderKind(value: unknown): value is SdkChildProviderKind {
  return (
    value === 'codex-sdk' || value === 'claude-sdk' || value === 'copilot-sdk' || value === 'pi-sdk'
  );
}

function installConsoleProtocolBridge(): () => void {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: unknown[]) => {
    writeLogEvent('stdout', args);
  };
  console.warn = (...args: unknown[]) => {
    writeLogEvent('stderr', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    writeLogEvent('stderr', args);
    original.error(...args);
  };

  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}

function writeLogEvent(stream: 'stdout' | 'stderr', args: readonly unknown[]): void {
  writeSdkChildEnvelope({
    protocol_version: SDK_CHILD_PROTOCOL_VERSION,
    type: 'event',
    event: {
      kind: 'log',
      stream,
      message: args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
    },
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks).toString('utf8').trim();
  if (!input) {
    throw new Error('SDK child runner expected a JSON request on stdin');
  }
  return input;
}

function errorToWire(error: unknown): SdkChildErrorWire {
  return {
    code: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

main().catch((error) => {
  writeSdkChildEnvelope({
    protocol_version: SDK_CHILD_PROTOCOL_VERSION,
    type: 'error',
    error: errorToWire(error),
  });
  process.exitCode = 1;
});
