import type { Message, SkillCall, ToolCall } from './types.js';

const SKILL_PATH_PATTERN =
  /(?:^|[/"'\s])(?:\.agents\/)?skills\/([^/"'\s]+)\/SKILL\.md(?:$|[)"'\s,;:])/g;

export function deriveSkillCallsFromMessages(
  messages: readonly Message[] | undefined,
): readonly SkillCall[] {
  if (!messages) {
    return [];
  }
  return deriveSkillCallsFromToolCalls(messages.flatMap((message) => message.toolCalls ?? []));
}

export function deriveSkillCallMetadataFromMessages(
  messages: readonly Message[] | undefined,
): ProviderResponseSkillMetadata | undefined {
  return skillCallMetadata(deriveSkillCallsFromMessages(messages));
}

export function deriveSkillCallsFromToolCalls(
  toolCalls: readonly ToolCall[] | undefined,
): readonly SkillCall[] {
  if (!toolCalls) {
    return [];
  }

  const skillCalls: SkillCall[] = [];
  const heuristicKeys = new Set<string>();

  const pushHeuristic = (entry: SkillCall) => {
    const key = `${entry.name}\0${entry.path ?? ''}\0${entry.source ?? ''}`;
    if (heuristicKeys.has(key)) {
      return;
    }
    heuristicKeys.add(key);
    skillCalls.push(entry);
  };

  for (const toolCall of toolCalls) {
    const toolName = toolCall.tool.toLowerCase();
    const input = asRecord(toolCall.input);
    const isError = isErroredToolCall(toolCall);

    if (toolName === 'skill') {
      const skillName = normalizeSkillName(input?.skill ?? input?.name);
      if (skillName) {
        skillCalls.push(
          dropUndefined({ name: skillName, input: toolCall.input, source: 'tool', isError }),
        );
      }
      continue;
    }

    if (toolName === 'read') {
      const path = normalizeText(input?.file_path ?? input?.path ?? input?.filePath);
      const skillName = path ? skillNameFromPath(path) : undefined;
      if (skillName) {
        pushHeuristic(
          dropUndefined({
            name: skillName,
            input: toolCall.input,
            path,
            source: 'heuristic',
            isError,
          }),
        );
      }
      continue;
    }

    if (toolName === 'bash') {
      const command = normalizeText(input?.command);
      if (command) {
        for (const candidate of skillPathCandidates(command)) {
          pushHeuristic(
            dropUndefined({
              name: candidate.name,
              input: toolCall.input,
              path: candidate.path,
              source: 'heuristic',
              isError,
            }),
          );
        }
      }
    }

    if (toolCall.output !== undefined) {
      const outputText =
        typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output);
      for (const candidate of skillPathCandidates(outputText)) {
        pushHeuristic(
          dropUndefined({
            name: candidate.name,
            path: candidate.path,
            source: 'heuristic',
            isError,
          }),
        );
      }
    }
  }

  return skillCalls;
}

export function skillCallMetadata(
  skillCalls: readonly SkillCall[],
): ProviderResponseSkillMetadata | undefined {
  if (skillCalls.length === 0) {
    return undefined;
  }
  const confirmed = skillCalls.filter((skillCall) => skillCall.isError !== true);
  return dropUndefined({
    skillCalls: confirmed.length > 0 ? confirmed : undefined,
    attemptedSkillCalls: confirmed.length < skillCalls.length ? skillCalls : undefined,
  });
}

type ProviderResponseSkillMetadata = {
  readonly skillCalls?: readonly SkillCall[];
  readonly attemptedSkillCalls?: readonly SkillCall[];
};

function skillPathCandidates(text: string): Array<{ name: string; path: string }> {
  const candidates = new Map<string, { name: string; path: string }>();
  for (const rawToken of text.split(/\s+/)) {
    const token = rawToken.replace(/^[`"'([{<]+|[`"',;:)\]}>]+$/g, '').replace(/\\/g, '/');
    const match = token.match(/(?:^|\/)(?:\.agents\/)?skills\/([^/\s]+)\/SKILL\.md$/);
    if (match && isValidSkillName(match[1])) {
      candidates.set(token, { name: match[1], path: token });
    }
  }

  for (const match of text.replace(/\\/g, '/').matchAll(SKILL_PATH_PATTERN)) {
    const pathMatch = match[0].match(/(?:\.agents\/)?skills\/([^/"'\s]+)\/SKILL\.md/);
    const name = pathMatch?.[1];
    if (name && isValidSkillName(name)) {
      candidates.set(pathMatch[0], { name, path: pathMatch[0] });
    }
  }

  return Array.from(candidates.values());
}

function skillNameFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  const match = normalized.match(/(?:^|\/)(?:\.agents\/)?skills\/([^/\s]+)\/SKILL\.md$/);
  const name = match?.[1];
  return name && isValidSkillName(name) ? name : undefined;
}

function isErroredToolCall(toolCall: ToolCall): boolean | undefined {
  if (toolCall.status === undefined || toolCall.status === 'ok' || toolCall.status === 'unknown') {
    return undefined;
  }
  return true;
}

function normalizeSkillName(value: unknown): string | undefined {
  return normalizeText(value);
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isValidSkillName(name: string): boolean {
  return /^[A-Za-z0-9._:-]+$/.test(name);
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
