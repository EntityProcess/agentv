/**
 * Phoenix OTel backend resolver.
 *
 * This file is the Phoenix-specific boundary for AgentV trace export routing.
 * Core receives only generic OTLP endpoint, headers, and resource attributes.
 */

import type { OtelBackendResolver } from '@agentv/core';

const DEFAULT_PHOENIX_COLLECTOR_ENDPOINT = 'http://localhost:6006';
const OPENINFERENCE_PROJECT_NAME = 'openinference.project.name';

export const phoenixOtelBackend: OtelBackendResolver = {
  name: 'phoenix',
  resolve: ({ env }) => {
    const warnings: string[] = [];
    const headers = parsePhoenixClientHeaders(env.PHOENIX_CLIENT_HEADERS, warnings);
    const apiKey = trimOptional(env.PHOENIX_API_KEY);

    if (apiKey && !hasHeader(headers, 'authorization')) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return {
      endpoint: normalizePhoenixTraceEndpoint(
        trimOptional(env.PHOENIX_COLLECTOR_ENDPOINT) ?? DEFAULT_PHOENIX_COLLECTOR_ENDPOINT,
      ),
      headers,
      resourceAttributes: {
        [OPENINFERENCE_PROJECT_NAME]: trimOptional(env.PHOENIX_PROJECT_NAME) ?? 'default',
      },
      warnings,
    };
  },
};

function normalizePhoenixTraceEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/traces')) {
    return trimmed;
  }
  return `${trimmed}/v1/traces`;
}

function parsePhoenixClientHeaders(
  value: string | undefined,
  warnings: string[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  const raw = trimOptional(value);

  if (!raw) {
    return headers;
  }

  for (const segment of raw.split(',')) {
    const entry = segment.trim();
    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      warnings.push(`Ignoring invalid PHOENIX_CLIENT_HEADERS entry: ${entry}`);
      continue;
    }

    const rawName = entry.slice(0, separatorIndex).trim();
    const rawHeaderValue = entry.slice(separatorIndex + 1).trim();

    try {
      const name = decodeURIComponent(rawName).trim().toLowerCase();
      const headerValue = decodeURIComponent(rawHeaderValue).trim();
      if (name) {
        headers[name] = headerValue;
      }
    } catch {
      warnings.push(`Ignoring invalid PHOENIX_CLIENT_HEADERS entry: ${entry}`);
    }
  }

  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === normalized);
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
