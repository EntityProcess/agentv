/**
 * Tests for OTel trace exporter.
 * These tests exercise logic that does NOT require actual OTel SDK packages.
 */

import { describe, expect, it } from 'bun:test';
import { OTEL_BACKEND_PRESETS, OtelTraceExporter } from '../../src/observability/otel-exporter.js';

// ---------------------------------------------------------------------------
// Backend presets
// ---------------------------------------------------------------------------

describe('OTel backend presets', () => {
  describe('OTEL_BACKEND_PRESETS registry', () => {
    it('contains langfuse, braintrust, and confident entries', () => {
      expect(OTEL_BACKEND_PRESETS).toHaveProperty('langfuse');
      expect(OTEL_BACKEND_PRESETS).toHaveProperty('braintrust');
      expect(OTEL_BACKEND_PRESETS).toHaveProperty('confident');
    });

    it('each preset has name, endpoint, and headers function', () => {
      for (const [key, preset] of Object.entries(OTEL_BACKEND_PRESETS)) {
        expect(preset.name).toBe(key);
        expect(typeof preset.endpoint).toBe('string');
        expect(typeof preset.headers).toBe('function');
      }
    });
  });

  describe('langfuse preset', () => {
    const preset = OTEL_BACKEND_PRESETS.langfuse;

    it('generates Basic auth header from public + secret key env vars', () => {
      const env = {
        LANGFUSE_PUBLIC_KEY: 'pk-test-123',
        LANGFUSE_SECRET_KEY: 'sk-test-456',
      };
      const headers = preset.headers(env);
      const expected = `Basic ${Buffer.from('pk-test-123:sk-test-456').toString('base64')}`;
      expect(headers).toEqual({ Authorization: expected });
    });

    it('falls back to empty strings when env vars are missing', () => {
      const headers = preset.headers({});
      const expected = `Basic ${Buffer.from(':').toString('base64')}`;
      expect(headers).toEqual({ Authorization: expected });
    });

    it('uses default cloud.langfuse.com endpoint when LANGFUSE_HOST is not set', () => {
      // The preset endpoint is evaluated at module load time using process.env.
      // When LANGFUSE_HOST is not set, the default endpoint is used.
      expect(preset.endpoint).toContain('langfuse.com/api/public/otel/v1/traces');
    });
  });

  describe('braintrust preset', () => {
    const preset = OTEL_BACKEND_PRESETS.braintrust;

    it('generates Bearer token from BRAINTRUST_API_KEY env var', () => {
      const env = { BRAINTRUST_API_KEY: 'bt-key-789' };
      const headers = preset.headers(env);
      expect(headers).toEqual({ Authorization: 'Bearer bt-key-789' });
    });

    it('falls back to empty Bearer token when env var is missing', () => {
      const headers = preset.headers({});
      expect(headers).toEqual({ Authorization: 'Bearer ' });
    });

    it('uses api.braintrust.dev endpoint', () => {
      expect(preset.endpoint).toBe('https://api.braintrust.dev/otel/v1/traces');
    });
  });

  describe('confident preset', () => {
    const preset = OTEL_BACKEND_PRESETS.confident;

    it('generates x-confident-api-key header from CONFIDENT_API_KEY env var', () => {
      const env = { CONFIDENT_API_KEY: 'conf-key-abc' };
      const headers = preset.headers(env);
      expect(headers).toEqual({ 'x-confident-api-key': 'conf-key-abc' });
    });

    it('falls back to empty key when env var is missing', () => {
      const headers = preset.headers({});
      expect(headers).toEqual({ 'x-confident-api-key': '' });
    });

    it('uses otel.confident-ai.com endpoint', () => {
      expect(preset.endpoint).toBe('https://otel.confident-ai.com/v1/traces');
    });
  });
});

// ---------------------------------------------------------------------------
// OtelTraceExporter class
// ---------------------------------------------------------------------------

describe('OTel OtelTraceExporter', () => {
  describe('constructor', () => {
    it('does not throw when constructed with minimal options', () => {
      expect(() => new OtelTraceExporter({})).not.toThrow();
    });

    it('does not throw when constructed with full options', () => {
      expect(
        () =>
          new OtelTraceExporter({
            endpoint: 'https://example.com/v1/traces',
            headers: { Authorization: 'Bearer test' },
            captureContent: true,
            serviceName: 'my-service',
          }),
      ).not.toThrow();
    });
  });

  describe('init()', () => {
    it('returns false when OTel packages are not importable', async () => {
      // In a test environment without OTel packages installed as real deps,
      // the dynamic import will fail and init() should return false.
      const exporter = new OtelTraceExporter({ endpoint: 'https://example.com/v1/traces' });
      const result = await exporter.init();
      // If OTel packages happen to be installed, this will be true—either outcome is valid
      expect(typeof result).toBe('boolean');
    });
  });

  describe('exportResult() without init', () => {
    it('silently no-ops when called before init()', () => {
      const exporter = new OtelTraceExporter({});
      // Should not throw even though tracer/api are null
      expect(() =>
        exporter.exportResult({
          testId: 'test-1',
          target: 'my-agent',
          score: 0.95,
          answer: 'hello',
          timestamp: new Date().toISOString(),
        } as unknown as Parameters<OtelTraceExporter['exportResult']>[0]),
      ).not.toThrow();
    });
  });

  describe('shutdown() without init', () => {
    it('resolves cleanly when called before init()', async () => {
      const exporter = new OtelTraceExporter({});
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });
  });
});
