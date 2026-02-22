import { flush, getTracer } from '../lib/otel.js';
import { deleteState, loadState } from '../lib/state.js';
import { readHookInput } from '../lib/types.js';

const input = readHookInput();
const state = await loadState(input.session_id);
if (!state) process.exit(0);

const otel = await getTracer();
if (otel) {
  const { tracer, api } = otel;

  // Create a final marker span to indicate session end
  const parentCtx = api.trace.setSpanContext(api.context.active(), {
    traceId: state.rootSpanTraceId,
    spanId: state.rootSpanId,
    traceFlags: 1,
    isRemote: false,
  });

  const endSpan = tracer.startSpan(
    'agentv.session.end',
    {
      attributes: {
        'agentv.session_id': state.sessionId,
        'agentv.turn_count': state.turnCount,
        'agentv.tool_count': state.toolCount,
      },
    },
    parentCtx,
  );
  endSpan.end();

  await flush();
}

// Clean up state file
await deleteState(input.session_id);
