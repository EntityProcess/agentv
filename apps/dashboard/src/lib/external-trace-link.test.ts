import { describe, expect, it } from 'bun:test';

import type { EvalResult } from './types';

import { findPhoenixExternalTraceUrl, sanitizeExternalTraceUiUrl } from './external-trace-link';

function resultWith(fields: Partial<EvalResult>): EvalResult {
  return {
    testId: 'test-greeting',
    score: 1,
    output: '',
    ...fields,
  };
}

describe('external trace links', () => {
  it('sanitizes ordinary external trace UI URLs before rendering', () => {
    expect(
      sanitizeExternalTraceUiUrl('https://phoenix.example/sessions/codex-session-1?token=secret#x'),
    ).toBe('https://phoenix.example/sessions/codex-session-1');
    expect(sanitizeExternalTraceUiUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeExternalTraceUiUrl('https://user:pass@phoenix.example/session')).toBeUndefined();
  });

  it('finds the first Phoenix UI URL from run detail results', () => {
    const url = findPhoenixExternalTraceUrl([
      resultWith({
        external_trace: {
          provider: 'phoenix',
          session_id: 'codex-session-1',
          ui_url: 'https://phoenix.example/sessions/codex-session-1?token=secret',
        },
      }),
    ]);

    expect(url).toBe('https://phoenix.example/sessions/codex-session-1');
  });

  it('supports legacy camelCase and flat metadata without linking other providers', () => {
    const results = [
      resultWith({
        externalTrace: {
          provider: 'langfuse',
          uiUrl: 'https://langfuse.example/traces/trace-1',
        },
      }),
      resultWith({
        metadata: {
          external_trace_provider: 'phoenix',
          external_trace_ui_url: 'https://phoenix.example/traces/trace-2',
        },
      }),
    ];

    expect(findPhoenixExternalTraceUrl(results)).toBe('https://phoenix.example/traces/trace-2');
  });
});
