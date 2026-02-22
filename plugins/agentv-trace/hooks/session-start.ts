import { getTracer } from '../lib/otel.js';
import { type SessionState, cleanupStaleStates, saveState } from '../lib/state.js';
import { readHookInput } from '../lib/types.js';

const input = readHookInput();
const otel = await getTracer();
if (!otel) process.exit(0);

const { tracer } = otel;

// Create root session span (self-contained — started and ended immediately)
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

// Don't end the root span — it stays open until SessionEnd
// Clean up stale states from previous sessions
await cleanupStaleStates();
