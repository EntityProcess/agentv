#!/usr/bin/env bun
import { defineCodeGrader } from '@agentv/eval';

export default defineCodeGrader(({ output }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Check 1: Has assistant messages
  const assistantMessages = output?.filter((m) => m.role === 'assistant') ?? [];
  assertions.push({
    text: `Contains assistant messages (found ${assistantMessages.length})`,
    passed: assistantMessages.length > 0,
  });

  // Check 2: Has tool calls with outputs
  const toolCalls = assistantMessages.flatMap((m) => m.toolCalls ?? []);
  const toolCallsWithOutput = toolCalls.filter((tc) => tc.output != null);
  assertions.push({
    text: `Tool calls have outputs (${toolCallsWithOutput.length}/${toolCalls.length})`,
    passed: toolCalls.length === 0 || toolCallsWithOutput.length > 0,
  });

  // Check 3: No empty assistant messages
  const emptyAssistant = assistantMessages.filter(
    (m) => !m.content && (!m.toolCalls || m.toolCalls.length === 0),
  );
  assertions.push({
    text: `No empty assistant messages (found ${emptyAssistant.length})`,
    passed: emptyAssistant.length === 0,
  });

  const passed = assertions.filter((a) => a.passed).length;
  return {
    score: assertions.length > 0 ? passed / assertions.length : 0,
    assertions,
  };
});
