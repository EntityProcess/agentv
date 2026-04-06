import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverCopilotSessions, parseCopilotEvents, toTranscriptJsonLine } from '@agentv/core';
import { command, flag, option, optional, string } from 'cmd-ts';

export const importCopilotCommand = command({
  name: 'copilot',
  description: 'Import a Copilot CLI session transcript for offline grading',
  args: {
    sessionId: option({
      type: optional(string),
      long: 'session-id',
      description: 'UUID of the Copilot CLI session to import',
    }),
    discover: option({
      type: optional(string),
      long: 'discover',
      description: 'Discovery mode: "latest" to import the most recent session',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description:
        'Output file path (default: .agentv/transcripts/copilot-<session-id-short>.jsonl)',
    }),
    sessionStateDir: option({
      type: optional(string),
      long: 'session-state-dir',
      description: 'Override the default ~/.copilot/session-state directory',
    }),
    list: flag({
      long: 'list',
      description: 'List available sessions instead of importing',
    }),
  },
  handler: async ({ sessionId, discover, output, sessionStateDir, list }) => {
    if (list) {
      const sessions = await discoverCopilotSessions({
        sessionStateDir,
        limit: 20,
      });

      if (sessions.length === 0) {
        console.log('No Copilot CLI sessions found.');
        return;
      }

      console.log(`Found ${sessions.length} session(s):\n`);
      for (const session of sessions) {
        const age = formatAge(session.updatedAt);
        const status = session.isActive ? ' (active)' : '';
        console.log(`  ${session.sessionId}  ${age}  ${session.cwd}${status}`);
      }
      return;
    }

    let sessionDir: string;
    let resolvedSessionId: string;

    if (sessionId) {
      const sessions = await discoverCopilotSessions({
        sessionStateDir,
        limit: 100,
      });
      const match = sessions.find((s: { sessionId: string }) => s.sessionId === sessionId);
      if (!match) {
        console.error(`Error: session ${sessionId} not found.`);
        process.exit(1);
      }
      sessionDir = match.sessionDir;
      resolvedSessionId = sessionId;
    } else if (discover === 'latest') {
      const sessions = await discoverCopilotSessions({
        sessionStateDir,
        limit: 1,
      });

      if (sessions.length === 0) {
        console.error('Error: no Copilot CLI sessions found.');
        process.exit(1);
      }
      sessionDir = sessions[0].sessionDir;
      resolvedSessionId = sessions[0].sessionId;
      console.log(`Discovered latest session: ${resolvedSessionId}`);
    } else {
      console.error('Error: specify --session-id <uuid> or --discover latest to select a session.');
      process.exit(1);
    }

    // Parse the session
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    const rawJsonl = await readFile(eventsPath, 'utf8');
    const parsed = parseCopilotEvents(rawJsonl);

    // Convert to TranscriptEntry format
    const transcript = {
      messages: parsed.messages,
      source: {
        provider: 'copilot' as const,
        sessionId: resolvedSessionId,
        cwd: parsed.meta.cwd,
        startedAt: parsed.meta.startedAt,
        model: parsed.meta.model,
      },
      tokenUsage: parsed.tokenUsage,
      durationMs: parsed.durationMs,
      costUsd: null as number | null,
    };

    // Determine output path
    const shortId = resolvedSessionId.slice(0, 8);
    const outputPath = output ?? path.join('.agentv', 'transcripts', `copilot-${shortId}.jsonl`);

    // Ensure output directory exists
    await mkdir(path.dirname(outputPath), { recursive: true });

    // Write transcript as JSONL (snake_case wire format)
    const jsonLine = toTranscriptJsonLine(transcript);
    await writeFile(outputPath, `${JSON.stringify(jsonLine)}\n`, 'utf8');

    const msgCount = transcript.messages.length;
    const toolCount = transcript.messages.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0);

    console.log(`Imported ${msgCount} messages (${toolCount} tool calls) → ${outputPath}`);

    if (transcript.source.model) {
      console.log(`  Model: ${transcript.source.model}`);
    }
    if (transcript.durationMs !== undefined) {
      console.log(`  Duration: ${formatDurationMs(transcript.durationMs)}`);
    }
    if (transcript.tokenUsage) {
      console.log(
        `  Tokens: ${transcript.tokenUsage.input} in / ${transcript.tokenUsage.output} out`,
      );
    }
  },
});

function formatAge(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
