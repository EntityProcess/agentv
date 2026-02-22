import { readHookInput } from "../lib/types.js";
import { loadState, saveState } from "../lib/state.js";
import { getTracer, flush } from "../lib/otel.js";

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
      "agentv.turn.number": state.turnCount,
      ...(input.prompt
        ? { "agentv.turn.prompt": input.prompt.substring(0, 200) }
        : {}),
    },
  },
  parentCtx,
);

state.currentTurnSpanId = turnSpan.spanContext().spanId;
await saveState(state);

// Don't end turn span yet — tool calls will be children
await flush();
