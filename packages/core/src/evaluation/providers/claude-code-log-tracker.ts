export type ClaudeCodeLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.claudeCodeLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.claudeCodeLogSubscribers');

type ClaudeCodeLogListener = (entry: ClaudeCodeLogEntry) => void;

type GlobalWithClaudeCodeLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: ClaudeCodeLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<ClaudeCodeLogListener>;
};

function getClaudeCodeLogStore(): ClaudeCodeLogEntry[] {
  const globalObject = globalThis as GlobalWithClaudeCodeLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: ClaudeCodeLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<ClaudeCodeLogListener> {
  const globalObject = globalThis as GlobalWithClaudeCodeLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<ClaudeCodeLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: ClaudeCodeLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      // Avoid surfacing subscriber errors to providers; log for visibility.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Claude Code log subscriber failed: ${message}`);
    }
  }
}

export function recordClaudeCodeLogEntry(entry: ClaudeCodeLogEntry): void {
  getClaudeCodeLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeClaudeCodeLogEntries(): ClaudeCodeLogEntry[] {
  const store = getClaudeCodeLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToClaudeCodeLogEntries(listener: ClaudeCodeLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
