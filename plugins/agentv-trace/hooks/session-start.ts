import { flush, getTracer } from '../lib/otel.js';
import { type SessionState, cleanupStaleStates, saveState } from '../lib/state.js';
import { readHookInput } from '../lib/types.js';

const input = readHookInput();
const otel = await getTracer();
if (!otel) process.exit(0);

const { tracer } = otel;

// Create root session span — serves as trace ID anchor for all subsequent hooks.
// Each hook runs in a separate process, so this span cannot be ended across processes.
// Child spans in later hooks reconstruct a parent context from the stored traceId/spanId.
const rootSpan = tracer.startSpan('agentv session', {
  attributes: {
    'gen_ai.system': 'agentv',
    'agentv.session_id': input.session_id,
    ...(input.cwd ? { 'agentv.workspace': input.cwd } : {}),
  },
});

const ctx = rootSpan.spanContext();

const state: SessionState = {
  sessionId: input.session_id,
  rootSpanTraceId: ctx.traceId,
  rootSpanId: ctx.spanId,
  turnCount: 0,
  toolCount: 0,
  startedAt: new Date().toISOString(),
};

await saveState(state);

// End and export the root span immediately — it serves as a trace anchor.
// Subsequent hooks create child spans using the stored traceId/spanId.
rootSpan.end();
await flush();
// Clean up stale states from previous sessions
await cleanupStaleStates();
