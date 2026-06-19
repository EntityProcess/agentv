#!/usr/bin/env bun
/**
 * Verifies that an agent inspected required repo guidance files from the
 * prepared workspace. This is intentionally suite-local: the general primitive
 * is code-grader, while this file encodes AgentV self-eval expectations.
 */
import { type Message, type ToolCall, type TraceEvent, defineCodeGrader } from '@agentv/sdk';

type Assertion = { text: string; passed: boolean; evidence?: string };

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizePath(value: string): string {
  return value
    .replace(/^file:\/\//, '')
    .replace(/\\/g, '/')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function pathMatches(candidate: string, expected: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedExpected = normalizePath(expected);
  return (
    normalizedCandidate === normalizedExpected ||
    normalizedCandidate.endsWith(`/${normalizedExpected}`)
  );
}

function textMentionsPath(text: string, expected: string): boolean {
  const normalizedText = normalizePath(text);
  const normalizedExpected = normalizePath(expected);
  return (
    normalizedText.includes(normalizedExpected) || normalizedText.includes(`/${normalizedExpected}`)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toolCallsFromMessages(messages: readonly Message[] | undefined): ToolCall[] {
  return (messages ?? []).flatMap((message) => [...(message.toolCalls ?? [])]);
}

function toolCallsFromTrace(events: readonly TraceEvent[] | undefined): ToolCall[] {
  return (events ?? [])
    .filter((event) => event.type === 'tool_call' && event.tool)
    .map((event) => ({
      tool: event.tool?.name ?? '',
      input: event.tool?.input,
      output: event.tool?.output,
      id: event.tool?.callId,
      durationMs: event.durationMs,
    }));
}

function allToolCalls(
  messages: readonly Message[],
  trace: { events?: readonly TraceEvent[] } | null | undefined,
): ToolCall[] {
  const seen = new Set<string>();
  const calls = [...toolCallsFromMessages(messages), ...toolCallsFromTrace(trace?.events)];

  return calls.filter((call) => {
    const key = JSON.stringify([call.tool, call.id, call.input, call.output]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readPathFromCall(call: ToolCall): string | undefined {
  const toolName = call.tool.toLowerCase();
  if (toolName !== 'read' && toolName !== 'read_file' && toolName !== 'readfile') {
    return undefined;
  }

  const input = asRecord(call.input);
  const path = input.file_path ?? input.path ?? input.filePath;
  return typeof path === 'string' ? path : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function bashCommand(call: ToolCall): string {
  const input = asRecord(call.input);
  const command = input.command ?? input.cmd ?? input.shell_command;
  return typeof command === 'string' ? command : '';
}

function commandReadsFiles(command: string): boolean {
  if (/\b(cat|sed|awk|head|tail|less|more|bat|nl)\b/.test(command)) {
    return true;
  }

  if (/\b(rg|grep)\b/.test(command)) {
    return !/\b--files\b/.test(command);
  }

  return false;
}

function evidenceForRequiredFile(call: ToolCall, expectedFile: string): string | undefined {
  const directPath = readPathFromCall(call);
  if (directPath && pathMatches(directPath, expectedFile)) {
    return `Read tool loaded ${directPath}`;
  }

  if (call.tool.toLowerCase() !== 'bash') {
    return undefined;
  }

  const command = bashCommand(call);
  if (!command || !commandReadsFiles(command)) {
    return undefined;
  }

  const output = stringify(call.output);
  if (textMentionsPath(command, expectedFile) || textMentionsPath(output, expectedFile)) {
    const compactCommand = command.replace(/\s+/g, ' ').trim();
    return `Bash command inspected ${expectedFile}: ${compactCommand.slice(0, 160)}`;
  }

  return undefined;
}

export default defineCodeGrader(({ config, messages, trace }) => {
  const requiredFiles = stringArray(config?.requiredFiles ?? config?.required_files);

  if (requiredFiles.length === 0) {
    return {
      score: 0,
      assertions: [{ text: 'required_files config is missing or empty', passed: false }],
    };
  }

  const toolCalls = allToolCalls(messages, trace);
  const assertions: Assertion[] = requiredFiles.map((file) => {
    const evidence = toolCalls
      .map((call) => evidenceForRequiredFile(call, file))
      .find((item): item is string => typeof item === 'string');

    return evidence
      ? { text: `Read required file: ${file}`, passed: true, evidence }
      : {
          text: `Read required file: ${file}`,
          passed: false,
          evidence:
            toolCalls.length > 0
              ? `Observed ${toolCalls.length} tool call(s), but none read ${file}`
              : 'No tool calls recorded',
        };
  });

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    score: passed / assertions.length,
    assertions,
  };
});
