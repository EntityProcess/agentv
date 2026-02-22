import { readHookInput } from "../lib/types.js";
import { loadState, saveState } from "../lib/state.js";
import { flush } from "../lib/otel.js";

const input = readHookInput();
const state = await loadState(input.session_id);
if (!state) process.exit(0);

// End current turn span by clearing it from state.
// Due to process isolation, we can't end the actual span object
// started in user-prompt-submit. The turn boundary is recorded
// by clearing the currentTurnSpanId so subsequent tool spans
// won't be parented to the old turn.
if (state.currentTurnSpanId) {
  state.currentTurnSpanId = undefined;
  await saveState(state);
}

await flush();
