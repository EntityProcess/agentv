import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  discoverCodexSessions,
  parseCodexSession,
  readTranscriptFile,
  toTranscriptJsonLine,
} from '@agentv/core';
import { command, flag, option, optional, string } from 'cmd-ts';

export const importCodexCommand = command({
  name: 'codex',
  description: 'Import a Codex CLI session transcript for offline grading',
  args: {
    discover: option({
      type: optional(string),
      long: 'discover',
      description: 'Discovery mode: "latest" to import the most recent session',
    }),
    date: option({
      type: optional(string),
      long: 'date',
      description: 'Filter sessions by date (YYYY-MM-DD)',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description: 'Output file path (default: .agentv/transcripts/codex-<timestamp>.jsonl)',
    }),
    sessionsDir: option({
      type: optional(string),
      long: 'sessions-dir',
      description: 'Override the default ~/.codex/sessions directory',
    }),
    list: flag({
      long: 'list',
      description: 'List available sessions instead of importing',
    }),
  },
  handler: async ({ discover, date, output, sessionsDir, list }) => {
    if (list) {
      const sessions = await discoverCodexSessions({
        date,
        sessionsDir,
        limit: 20,
      });

      if (sessions.length === 0) {
        console.log('No Codex CLI sessions found.');
        return;
      }

      console.log(`Found ${sessions.length} session(s):\n`);
      for (const session of sessions) {
        const age = formatAge(session.updatedAt);
        console.log(`  ${session.sessionId}  ${age}  ${session.filename}`);
      }
      return;
    }

    if (discover !== 'latest') {
      console.error('Error: specify --discover latest to select a session.');
      process.exit(1);
    }

    const sessions = await discoverCodexSessions({
      date,
      sessionsDir,
      latest: true,
    });

    if (sessions.length === 0) {
      console.error('Error: no Codex CLI sessions found.');
      process.exit(1);
    }

    const session = sessions[0];
    console.log(`Discovered latest session: ${session.filename}`);

    // Parse the session
    const rawJsonl = await readTranscriptFile(session.filePath);
    const transcript = parseCodexSession(rawJsonl);

    // Determine output path
    const shortId = session.sessionId.slice(0, 8);
    const outputPath = output ?? path.join('.agentv', 'transcripts', `codex-${shortId}.jsonl`);

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
