export type ClaudeLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.claudeLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.claudeLogSubscribers');

type ClaudeLogListener = (entry: ClaudeLogEntry) => void;

type GlobalWithClaudeLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: ClaudeLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<ClaudeLogListener>;
};

function getClaudeLogStore(): ClaudeLogEntry[] {
  const globalObject = globalThis as GlobalWithClaudeLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: ClaudeLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<ClaudeLogListener> {
  const globalObject = globalThis as GlobalWithClaudeLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<ClaudeLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: ClaudeLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Claude log subscriber failed: ${message}`);
    }
  }
}

export function recordClaudeLogEntry(entry: ClaudeLogEntry): void {
  getClaudeLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeClaudeLogEntries(): ClaudeLogEntry[] {
  const store = getClaudeLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToClaudeLogEntries(listener: ClaudeLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
