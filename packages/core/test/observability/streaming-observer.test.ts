/**
 * Tests for OtelStreamingObserver.
 * Uses mock tracer/api objects to verify span creation and attribute setting.
 */

import { describe, expect, it } from 'bun:test';
import { OtelStreamingObserver } from '../../src/observability/otel-exporter.js';

// ---------------------------------------------------------------------------
// Mock OTel primitives
// ---------------------------------------------------------------------------

interface MockSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  ended: boolean;
}

function createMockSpan(name: string): MockSpan {
  return {
    name,
    attributes: {},
    ended: false,
    setAttribute(key: string, value: unknown) {
      this.attributes[key] = value;
    },
    setStatus(status: { code: number; message?: string }) {
      this.status = status;
    },
    end() {
      this.ended = true;
    },
  };
}

function createMockTracer(spans: MockSpan[]) {
  return {
    startSpan(name: string) {
      const span = createMockSpan(name);
      spans.push(span);
      return span;
    },
  };
}

function createMockApi() {
  return {
    trace: {
      setSpan(_ctx: unknown, _span: unknown) {
        return { spanSet: true };
      },
    },
    context: {
      active() {
        return {};
      },
      with(_ctx: unknown, fn: () => void) {
        fn();
      },
    },
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OtelStreamingObserver', () => {
  it('creates a root eval span on startEvalCase', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'my-target', 'my-dataset');

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('agentv.eval');
    expect(spans[0].attributes['agentv.test_id']).toBe('test-1');
    expect(spans[0].attributes['agentv.target']).toBe('my-target');
    expect(spans[0].attributes['agentv.dataset']).toBe('my-dataset');
    expect(spans[0].attributes['gen_ai.system']).toBe('agentv');
    expect(spans[0].ended).toBe(false);
  });

  it('creates a tool span on onToolCall', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), true);

    observer.startEvalCase('test-1', 'target');
    observer.onToolCall('read_file', { path: '/a.txt' }, 'contents', 150, 'tc-1');

    expect(spans).toHaveLength(2);
    const toolSpan = spans[1];
    expect(toolSpan.name).toBe('execute_tool read_file');
    expect(toolSpan.attributes['gen_ai.tool.name']).toBe('read_file');
    expect(toolSpan.attributes['gen_ai.tool.call.id']).toBe('tc-1');
    expect(toolSpan.attributes['gen_ai.tool.call.arguments']).toBe('{"path":"/a.txt"}');
    expect(toolSpan.attributes['gen_ai.tool.call.result']).toBe('contents');
    expect(toolSpan.ended).toBe(true);
  });

  it('omits content attributes when captureContent is false', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'target');
    observer.onToolCall('bash', 'ls', 'output', 50);

    const toolSpan = spans[1];
    expect(toolSpan.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(toolSpan.attributes['gen_ai.tool.call.result']).toBeUndefined();
  });

  it('creates an LLM span on onLlmCall', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'target');
    observer.onLlmCall('claude-sonnet-4-20250514', { input: 100, output: 50, cached: 20 });

    expect(spans).toHaveLength(2);
    const llmSpan = spans[1];
    expect(llmSpan.name).toBe('chat claude-sonnet-4-20250514');
    expect(llmSpan.attributes['gen_ai.operation.name']).toBe('chat');
    expect(llmSpan.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-20250514');
    expect(llmSpan.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(llmSpan.attributes['gen_ai.usage.output_tokens']).toBe(50);
    expect(llmSpan.attributes['gen_ai.usage.cache_read.input_tokens']).toBe(20);
    expect(llmSpan.ended).toBe(true);
  });

  it('finalizes root span with OK status and score', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'target');
    observer.finalizeEvalCase(0.85);

    const rootSpan = spans[0];
    expect(rootSpan.attributes['agentv.score']).toBe(0.85);
    expect(rootSpan.status).toEqual({ code: 1 });
    expect(rootSpan.ended).toBe(true);
  });

  it('finalizes root span with ERROR status on error', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'target');
    observer.finalizeEvalCase(0, 'timeout');

    const rootSpan = spans[0];
    expect(rootSpan.attributes['agentv.score']).toBe(0);
    expect(rootSpan.status).toEqual({ code: 2, message: 'timeout' });
    expect(rootSpan.ended).toBe(true);
  });

  it('no-ops when startEvalCase was not called', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    // Should not throw
    observer.onToolCall('bash', 'ls', 'ok', 10);
    observer.onLlmCall('gpt-4', { input: 10, output: 5 });
    observer.finalizeEvalCase(1.0);

    expect(spans).toHaveLength(0);
  });

  it('getStreamCallbacks returns working callbacks', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), false);

    observer.startEvalCase('test-1', 'target');
    const callbacks = observer.getStreamCallbacks();

    callbacks.onToolCallEnd?.('write_file', null, null, 100, 'tc-2');
    callbacks.onLlmCallEnd?.('gpt-4', { input: 50, output: 25 });

    // root + tool + llm = 3 spans
    expect(spans).toHaveLength(3);
    expect(spans[1].name).toBe('execute_tool write_file');
    expect(spans[2].name).toBe('chat gpt-4');
  });

  it('handles full lifecycle: start → tools → llm → finalize', () => {
    const spans: MockSpan[] = [];
    const observer = new OtelStreamingObserver(createMockTracer(spans), createMockApi(), true);

    observer.startEvalCase('lifecycle-test', 'claude-target', 'qa-dataset');
    observer.onToolCall('search', { q: 'test' }, ['result1'], 200, 'tc-a');
    observer.onLlmCall('claude-sonnet-4-20250514', { input: 500, output: 100 });
    observer.onToolCall('write', { path: 'out.txt' }, 'ok', 50, 'tc-b');
    observer.onLlmCall('claude-sonnet-4-20250514', { input: 600, output: 150 });
    observer.finalizeEvalCase(1.0);

    // root + 2 tools + 2 llm = 5 spans
    expect(spans).toHaveLength(5);
    expect(spans[0].ended).toBe(true);
    expect(spans[0].attributes['agentv.score']).toBe(1.0);
    expect(spans.every((s) => s.ended)).toBe(true);
  });
});
