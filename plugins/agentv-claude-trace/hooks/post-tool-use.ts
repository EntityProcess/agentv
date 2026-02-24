import { flush, getTracer } from '../lib/otel.js';
import { loadState, saveState } from '../lib/state.js';
import { readHookInput } from '../lib/types.js';

const input = readHookInput();
const state = await loadState(input.session_id);
if (!state) process.exit(0);

const otel = await getTracer();
if (!otel) process.exit(0);

const { tracer, api } = otel;
state.toolCount += 1;

// Create tool span as child of current turn (or root if no turn)
const parentSpanId = state.currentTurnSpanId ?? state.rootSpanId;
const parentCtx = api.trace.setSpanContext(api.context.active(), {
  traceId: state.rootSpanTraceId,
  spanId: parentSpanId,
  traceFlags: 1,
  isRemote: false,
});

const toolName = input.tool_name ?? 'unknown';
const toolSpan = tracer.startSpan(
  `execute_tool ${toolName}`,
  {
    attributes: {
      'gen_ai.tool.name': toolName,
      'gen_ai.operation.name': 'tool',
    },
  },
  parentCtx,
);

// Tool span is complete — end immediately
toolSpan.end();

await saveState(state);
await flush();
