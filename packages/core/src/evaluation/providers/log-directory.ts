import path from 'node:path';

import type { ProviderRequest } from './types.js';

function safePathSegment(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[/\\:*?"<>|]/g, '_');
}

export function resolveDefaultProviderLogDir(
  providerName: string,
  request?: Pick<ProviderRequest, 'evalCaseId' | 'suite'>,
): string | undefined {
  const runDir = process.env.AGENTV_RUN_DIR?.trim();
  if (runDir) {
    if (request?.evalCaseId) {
      const segments = [
        request.suite ? safePathSegment(request.suite, 'default') : undefined,
        safePathSegment(request.evalCaseId, 'unknown'),
        'logs',
        providerName,
      ].filter((segment): segment is string => segment !== undefined);
      return path.join(path.resolve(runDir), ...segments);
    }
    return path.join(path.resolve(runDir), '_logs', providerName);
  }
  return undefined;
}
