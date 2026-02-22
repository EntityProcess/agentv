import { flush, getTracer } from '../lib/otel.js';
import { loadState, saveState } from '../lib/state.js';
import { readHookInput } from '../lib/types.js';

const input = readHookInput();
const state = await loadState(input.session_id);
if (!state) process.exit(0);

const otel = await getTracer();
if (!otel) process.exit(0);

const { tracer, api } = otel;

state.turnCount += 1;

// Create a turn span as child of root session span
const parentCtx = api.trace.setSpanContext(api.context.active(), {
  traceId: state.rootSpanTraceId,
  spanId: state.rootSpanId,
  traceFlags: 1,
  isRemote: false,
});

const turnSpan = tracer.startSpan(
  `agentv.turn.${state.turnCount}`,
  {
    attributes: {
      'agentv.turn.number': state.turnCount,
      ...(input.prompt ? { 'agentv.turn.prompt': input.prompt.substring(0, 200) } : {}),
    },
  },
  parentCtx,
);

state.currentTurnSpanId = turnSpan.spanContext().spanId;
await saveState(state);

// End turn span immediately — each hook runs in a separate process so we can't
// keep spans open across hooks. Tool call spans link via stored spanId.
turnSpan.end();
await flush();
