import type { EvalResult } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function sanitizeExternalTraceUiUrl(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function isPhoenixTrace(value: Record<string, unknown>): boolean {
  const provider = nonEmptyString(value.provider);
  return provider === undefined || provider.toLowerCase() === 'phoenix';
}

function flatExternalTraceFromMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return {
    provider: metadata.external_trace_provider ?? metadata['external_trace.provider'],
    ui_url:
      metadata.external_trace_ui_url ??
      metadata.external_trace_url ??
      metadata['external_trace.ui_url'] ??
      metadata['external_trace.url'],
  };
}

function externalTraceCandidates(result: EvalResult): unknown[] {
  const raw = result as EvalResult & {
    readonly externalTrace?: unknown;
    readonly external_trace?: unknown;
  };
  const metadata = isRecord(result.metadata) ? result.metadata : undefined;
  return [
    raw.external_trace,
    raw.externalTrace,
    metadata?.external_trace,
    metadata?.externalTrace,
    flatExternalTraceFromMetadata(metadata),
  ];
}

export function findPhoenixExternalTraceUrl(results: readonly EvalResult[]): string | undefined {
  for (const result of results) {
    for (const candidate of externalTraceCandidates(result)) {
      if (!isRecord(candidate) || !isPhoenixTrace(candidate)) continue;

      const url = sanitizeExternalTraceUiUrl(
        candidate.ui_url ?? candidate.uiUrl ?? candidate.url ?? candidate.href,
      );
      if (url) return url;
    }
  }
  return undefined;
}
