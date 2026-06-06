#!/usr/bin/env bun
import { type Message, type ToolCall, defineCodeGrader } from '@agentv/eval';

function allToolCalls(output: readonly Message[] | null | undefined): ToolCall[] {
  return (output ?? []).flatMap((message) => [...(message.toolCalls ?? [])]);
}

function hasErrorOutput(call: ToolCall): boolean {
  const output = call.output;
  return (
    typeof output === 'object' &&
    output !== null &&
    ((output as Record<string, unknown>).status === 'error' ||
      typeof (output as Record<string, unknown>).error === 'string')
  );
}

function assistantText(output: readonly Message[] | null | undefined): string {
  return (output ?? [])
    .filter((message) => message.role === 'assistant' && typeof message.content === 'string')
    .map((message) => message.content)
    .join('\n')
    .toLowerCase();
}

export default defineCodeGrader(({ output }) => {
  const toolCalls = allToolCalls(output);
  const text = assistantText(output);

  const failedReadIndex = toolCalls.findIndex(
    (call) => call.tool === 'Read' && hasErrorOutput(call),
  );
  const recoveredReadIndex = toolCalls.findIndex(
    (call, index) =>
      index > failedReadIndex &&
      call.tool === 'Read' &&
      (call.input as { path?: string } | undefined)?.path === 'src/config.ts',
  );
  const editIndex = toolCalls.findIndex(
    (call, index) =>
      index > recoveredReadIndex &&
      call.tool === 'Edit' &&
      (call.input as { path?: string } | undefined)?.path === 'src/config.ts',
  );

  const assertions = [
    {
      text: 'Trace includes an initial failed Read call',
      passed: failedReadIndex >= 0,
    },
    {
      text: 'Trace recovers by reading src/config.ts after the failure',
      passed: recoveredReadIndex > failedReadIndex,
    },
    {
      text: 'Trace edits src/config.ts after recovering',
      passed: editIndex > recoveredReadIndex,
    },
    {
      text: 'Final answer explains recovery from the missing path',
      passed: text.includes('recovered') && text.includes('missing'),
    },
  ];

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    score: passed / assertions.length,
    assertions,
  };
});
