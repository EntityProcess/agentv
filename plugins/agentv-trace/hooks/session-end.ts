import { readHookInput } from "../lib/types.js";
import { loadState, deleteState } from "../lib/state.js";
import { getTracer, flush } from "../lib/otel.js";

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
    "agentv.session.end",
    {
      attributes: {
        "agentv.session_id": state.sessionId,
        "agentv.turn_count": state.turnCount,
        "agentv.tool_count": state.toolCount,
      },
    },
    parentCtx,
  );
  endSpan.end();

  await flush();
}

// Clean up state file
await deleteState(input.session_id);
