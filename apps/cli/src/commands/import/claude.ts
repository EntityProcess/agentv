import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  discoverClaudeSessions,
  parseClaudeSession,
  readTranscriptFile,
  toTranscriptJsonLine,
} from '@agentv/core';
import { command, flag, option, optional, string } from 'cmd-ts';

export const importClaudeCommand = command({
  name: 'claude',
  description: 'Import a Claude Code session transcript for offline grading',
  args: {
    sessionId: option({
      type: optional(string),
      long: 'session-id',
      description: 'UUID of the Claude Code session to import',
    }),
    projectPath: option({
      type: optional(string),
      long: 'project-path',
      description: 'Filter sessions by project path',
    }),
    output: option({
      type: optional(string),
      long: 'output',
      short: 'o',
      description:
        'Output file path (default: .agentv/transcripts/claude-<session-id-short>.jsonl)',
    }),
    projectsDir: option({
      type: optional(string),
      long: 'projects-dir',
      description: 'Override the default ~/.claude/projects directory',
    }),
    list: flag({
      long: 'list',
      description: 'List available sessions instead of importing',
    }),
  },
  handler: async ({ sessionId, projectPath, output, projectsDir, list }) => {
    if (list) {
      const sessions = await discoverClaudeSessions({
        projectPath,
        projectsDir,
        limit: 20,
      });

      if (sessions.length === 0) {
        console.log('No Claude Code sessions found.');
        return;
      }

      console.log(`Found ${sessions.length} session(s):\n`);
      for (const session of sessions) {
        const age = formatAge(session.updatedAt);
        console.log(`  ${session.sessionId}  ${age}  ${session.projectDir}`);
      }
      return;
    }

    // Determine which session to import
    let sessionFilePath: string;

    if (sessionId) {
      const sessions = await discoverClaudeSessions({
        sessionId,
        projectPath,
        projectsDir,
        limit: 1,
      });

      if (sessions.length === 0) {
        console.error(`Error: session ${sessionId} not found.`);
        process.exit(1);
      }
      sessionFilePath = sessions[0].filePath;
    } else {
      console.error(
        'Error: specify --session-id <uuid> to select a session. Use --list to see available sessions.',
      );
      process.exit(1);
    }

    // Parse the session
    const rawJsonl = await readTranscriptFile(sessionFilePath);
    const transcript = parseClaudeSession(rawJsonl);

    // Determine output path
    const shortId = (sessionId ?? transcript.source.sessionId).slice(0, 8);
    const outputPath = output ?? path.join('.agentv', 'transcripts', `claude-${shortId}.jsonl`);

    // Ensure output directory exists
    await mkdir(path.dirname(outputPath), { recursive: true });

    // Write transcript as JSONL (one line per test case, snake_case wire format)
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
