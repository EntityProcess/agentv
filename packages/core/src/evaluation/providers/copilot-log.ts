/**
 * Copilot Log provider — reads Copilot CLI session transcripts from disk.
 *
 * Zero-cost alternative to spawning a Copilot CLI instance. Reads
 * ~/.copilot/session-state/{uuid}/events.jsonl and converts to Message[].
 *
 * Config options (specify ONE of these to identify the session):
 *   sessionDir      — explicit path to a session directory
 *   sessionId       — session UUID (combined with sessionStateDir)
 *   discover        — 'latest' to auto-discover most recent session
 *
 * Optional:
 *   sessionStateDir — override ~/.copilot/session-state
 *   cwd             — filter discovery by working directory
 *
 * The invoke() method ignores request.question since no process is spawned.
 * It reads the transcript file and returns a ProviderResponse with the
 * parsed Message[] in the output field.
 *
 * File-change tracking:
 *   After reading the transcript, the provider automatically scans the
 *   session's `files/` subdirectory for artifacts generated during the
 *   session (e.g. CSV / Markdown reports saved by Copilot).  Any files
 *   found are returned as synthetic unified diffs in `fileChanges` so that
 *   LLM and code graders can evaluate them via `{{file_changes}}` without
 *   requiring the agent to echo file contents in its final answer.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { captureSessionArtifacts } from '../workspace/file-changes.js';
import { parseCopilotEvents } from './copilot-log-parser.js';
import { discoverCopilotSessions } from './copilot-session-discovery.js';
import type { CopilotLogResolvedConfig } from './targets.js';
import type { Provider, ProviderRequest, ProviderResponse } from './types.js';

export class CopilotLogProvider implements Provider {
  readonly id: string;
  readonly kind = 'copilot-log' as const;
  readonly targetName: string;

  private readonly config: CopilotLogResolvedConfig;

  constructor(targetName: string, config: CopilotLogResolvedConfig) {
    this.targetName = targetName;
    this.id = `copilot-log:${targetName}`;
    this.config = config;
  }

  async invoke(_request: ProviderRequest): Promise<ProviderResponse> {
    const sessionDir = await this.resolveSessionDir();
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    let eventsContent: string;
    try {
      eventsContent = await readFile(eventsPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Failed to read Copilot session transcript at ${eventsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseCopilotEvents(eventsContent);

    // Scan session-state `files/` directory for artifacts generated during
    // the session (e.g. CSV reports). Return as synthetic diffs so graders
    // can evaluate them via {{file_changes}} without special eval wiring.
    const filesDir = path.join(sessionDir, 'files');
    const fileChanges = await captureSessionArtifacts(filesDir).catch(() => undefined);

    return {
      output: parsed.messages,
      tokenUsage: parsed.tokenUsage,
      durationMs: parsed.durationMs,
      startTime: parsed.meta.startedAt,
      ...(fileChanges ? { fileChanges } : {}),
    };
  }

  private async resolveSessionDir(): Promise<string> {
    if (this.config.sessionDir) {
      return this.config.sessionDir;
    }

    if (this.config.sessionId) {
      const stateDir =
        this.config.sessionStateDir ?? path.join(homedir(), '.copilot', 'session-state');
      return path.join(stateDir, this.config.sessionId);
    }

    if (this.config.discover === 'latest') {
      const sessions = await discoverCopilotSessions({
        sessionStateDir: this.config.sessionStateDir,
        cwd: this.config.cwd,
        limit: 1,
      });

      if (sessions.length === 0) {
        throw new Error(
          `No Copilot CLI sessions found${this.config.cwd ? ` for cwd=${this.config.cwd}` : ''}. ` +
            `Check that sessions exist in ${this.config.sessionStateDir ?? '~/.copilot/session-state/'}`,
        );
      }

      return sessions[0].sessionDir;
    }

    throw new Error(
      'CopilotLogProvider requires one of: sessionDir, sessionId, or discover="latest"',
    );
  }
}
