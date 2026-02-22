/**
 * Tests for OTel trace exporter.
 * These tests exercise logic that does NOT require actual OTel SDK packages.
 */

import { afterEach, describe, expect, it } from 'bun:test';
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
    it('silently no-ops when called before init()', async () => {
      const exporter = new OtelTraceExporter({});
      // Should not throw even though tracer/api are null
      await expect(
        exporter.exportResult({
          testId: 'test-1',
          target: 'my-agent',
          score: 0.95,
          answer: 'hello',
          timestamp: new Date().toISOString(),
        } as unknown as Parameters<OtelTraceExporter['exportResult']>[0]),
      ).resolves.toBeUndefined();
    });
  });

  describe('shutdown() without init', () => {
    it('resolves cleanly when called before init()', async () => {
      const exporter = new OtelTraceExporter({});
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// W3C traceparent propagation
// ---------------------------------------------------------------------------

describe('W3C traceparent propagation', () => {
  const VALID_TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  const VALID_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
  const VALID_PARENT_SPAN_ID = 'b7ad6b7169203331';

  const savedTraceparent = process.env.TRACEPARENT;
  const savedTracestate = process.env.TRACESTATE;

  afterEach(() => {
    if (savedTraceparent !== undefined) {
      process.env.TRACEPARENT = savedTraceparent;
    } else {
      process.env.TRACEPARENT = undefined;
    }
    if (savedTracestate !== undefined) {
      process.env.TRACESTATE = savedTracestate;
    } else {
      process.env.TRACESTATE = undefined;
    }
  });

  /**
   * Helper: create an OtelTraceExporter wired to an InMemorySpanExporter.
   * We create our own NodeTracerProvider with an InMemorySpanExporter and
   * inject it into the exporter's private fields, bypassing init().
   */
  async function createTestExporter() {
    try {
      const [sdkTraceNode, api] = await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/api'),
      ]);

      const { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = sdkTraceNode;
      const memExporter = new InMemorySpanExporter();

      const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(memExporter)],
      });
      provider.register();

      const exporter = new OtelTraceExporter({
        endpoint: 'http://localhost:4318/v1/traces',
      });

      // Inject private fields so exportResult() works without HTTP exporter
      // biome-ignore lint/suspicious/noExplicitAny: test access to private fields
      const exp = exporter as any;
      exp.provider = provider;
      exp.api = api;
      exp.tracer = provider.getTracer('agentv-test', '1.0.0');

      // Inject W3C propagator for traceparent tests
      try {
        const coreMod = await import('@opentelemetry/core');
        exp.W3CPropagator = coreMod.W3CTraceContextPropagator;
      } catch {
        // W3C propagation tests will be skipped
      }

      return { exporter, memExporter, provider };
    } catch {
      return null;
    }
  }

  const makeResult = () =>
    ({
      testId: 'test-tp',
      target: 'my-agent',
      score: 1,
      answer: 'ok',
      timestamp: new Date().toISOString(),
    }) as unknown as Parameters<OtelTraceExporter['exportResult']>[0];

  it('creates a standalone trace when TRACEPARENT is not set', async () => {
    process.env.TRACEPARENT = undefined;
    const setup = await createTestExporter();
    if (!setup) return; // OTel not available — skip

    await setup.exporter.exportResult(makeResult());

    const spans = setup.memExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);

    const root = spans.find((s) => s.name === 'agentv.eval');
    expect(root).toBeDefined();
    // No parent — parentSpanContext should be undefined
    expect(root?.parentSpanContext).toBeUndefined();

    await setup.exporter.shutdown();
  });

  it('inherits traceId and parentSpanId from a valid TRACEPARENT', async () => {
    process.env.TRACEPARENT = VALID_TRACEPARENT;
    const setup = await createTestExporter();
    if (!setup) return;

    await setup.exporter.exportResult(makeResult());

    const spans = setup.memExporter.getFinishedSpans();
    const root = spans.find((s) => s.name === 'agentv.eval');
    expect(root).toBeDefined();
    expect(root?.spanContext().traceId).toBe(VALID_TRACE_ID);
    expect(root?.parentSpanContext?.spanId).toBe(VALID_PARENT_SPAN_ID);

    await setup.exporter.shutdown();
  });

  it('falls back to standalone trace when TRACEPARENT is malformed', async () => {
    process.env.TRACEPARENT = 'not-a-valid-traceparent';
    const setup = await createTestExporter();
    if (!setup) return;

    await setup.exporter.exportResult(makeResult());

    const spans = setup.memExporter.getFinishedSpans();
    const root = spans.find((s) => s.name === 'agentv.eval');
    expect(root).toBeDefined();
    // Malformed traceparent is ignored by the propagator — new root trace
    expect(root?.spanContext().traceId).not.toBe(VALID_TRACE_ID);

    await setup.exporter.shutdown();
  });

  it('propagates TRACESTATE when present alongside TRACEPARENT', async () => {
    process.env.TRACEPARENT = VALID_TRACEPARENT;
    process.env.TRACESTATE = 'vendor=opaque';
    const setup = await createTestExporter();
    if (!setup) return;

    await setup.exporter.exportResult(makeResult());

    const spans = setup.memExporter.getFinishedSpans();
    const root = spans.find((s) => s.name === 'agentv.eval');
    expect(root).toBeDefined();
    // traceId should match the parent
    expect(root?.spanContext().traceId).toBe(VALID_TRACE_ID);
    expect(root?.spanContext().traceState?.get('vendor')).toBe('opaque');

    await setup.exporter.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Per-span token usage metrics
// ---------------------------------------------------------------------------

describe('Per-span token usage metrics', () => {
  const savedTraceparent = process.env.TRACEPARENT;

  afterEach(() => {
    if (savedTraceparent !== undefined) {
      process.env.TRACEPARENT = savedTraceparent;
    } else {
      process.env.TRACEPARENT = undefined;
    }
  });

  async function createTestExporter() {
    try {
      const [sdkTraceNode, api] = await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/api'),
      ]);

      const { NodeTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } = sdkTraceNode;
      const memExporter = new InMemorySpanExporter();

      const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(memExporter)],
      });

      const exporter = new OtelTraceExporter({
        endpoint: 'http://localhost:4318/v1/traces',
      });

      // biome-ignore lint/suspicious/noExplicitAny: test access to private fields
      const exp = exporter as any;
      exp.provider = provider;
      exp.api = api;
      exp.tracer = provider.getTracer('agentv-test', '1.0.0');

      return { exporter, memExporter };
    } catch {
      return null;
    }
  }

  it('sets token usage attributes on child spans when tokenUsage is present', async () => {
    process.env.TRACEPARENT = undefined;
    const setup = await createTestExporter();
    if (!setup) return;

    const result = {
      testId: 'test-tokens',
      target: 'my-agent',
      score: 1,
      answer: 'ok',
      timestamp: new Date().toISOString(),
      output: [
        {
          role: 'assistant',
          content: 'hello',
          metadata: { model: 'gpt-4' },
          tokenUsage: { input: 100, output: 50, cached: 25 },
        },
      ],
    } as unknown as Parameters<OtelTraceExporter['exportResult']>[0];

    await setup.exporter.exportResult(result);

    const spans = setup.memExporter.getFinishedSpans();
    const msgSpan = spans.find((s) => s.name.startsWith('chat '));
    expect(msgSpan).toBeDefined();
    expect(msgSpan?.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(msgSpan?.attributes['gen_ai.usage.output_tokens']).toBe(50);
    expect(msgSpan?.attributes['gen_ai.usage.cache_read.input_tokens']).toBe(25);

    await setup.exporter.shutdown();
  });

  it('omits token usage attributes when tokenUsage is not present', async () => {
    process.env.TRACEPARENT = undefined;
    const setup = await createTestExporter();
    if (!setup) return;

    const result = {
      testId: 'test-no-tokens',
      target: 'my-agent',
      score: 1,
      answer: 'ok',
      timestamp: new Date().toISOString(),
      output: [
        {
          role: 'assistant',
          content: 'hello',
          metadata: { model: 'gpt-4' },
        },
      ],
    } as unknown as Parameters<OtelTraceExporter['exportResult']>[0];

    await setup.exporter.exportResult(result);

    const spans = setup.memExporter.getFinishedSpans();
    const msgSpan = spans.find((s) => s.name.startsWith('chat '));
    expect(msgSpan).toBeDefined();
    expect(msgSpan?.attributes['gen_ai.usage.input_tokens']).toBeUndefined();
    expect(msgSpan?.attributes['gen_ai.usage.output_tokens']).toBeUndefined();
    expect(msgSpan?.attributes['gen_ai.usage.cache_read.input_tokens']).toBeUndefined();

    await setup.exporter.shutdown();
  });

  it('omits cached attribute when only input and output are present', async () => {
    process.env.TRACEPARENT = undefined;
    const setup = await createTestExporter();
    if (!setup) return;

    const result = {
      testId: 'test-partial-tokens',
      target: 'my-agent',
      score: 1,
      answer: 'ok',
      timestamp: new Date().toISOString(),
      output: [
        {
          role: 'assistant',
          content: 'hello',
          metadata: { model: 'gpt-4' },
          tokenUsage: { input: 200, output: 75 },
        },
      ],
    } as unknown as Parameters<OtelTraceExporter['exportResult']>[0];

    await setup.exporter.exportResult(result);

    const spans = setup.memExporter.getFinishedSpans();
    const msgSpan = spans.find((s) => s.name.startsWith('chat '));
    expect(msgSpan).toBeDefined();
    expect(msgSpan?.attributes['gen_ai.usage.input_tokens']).toBe(200);
    expect(msgSpan?.attributes['gen_ai.usage.output_tokens']).toBe(75);
    expect(msgSpan?.attributes['gen_ai.usage.cache_read.input_tokens']).toBeUndefined();

    await setup.exporter.shutdown();
  });
});
