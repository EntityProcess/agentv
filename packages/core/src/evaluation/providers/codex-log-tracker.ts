export type CodexLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.codexLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.codexLogSubscribers');

type CodexLogListener = (entry: CodexLogEntry) => void;

type GlobalWithCodexLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: CodexLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<CodexLogListener>;
};

function getCodexLogStore(): CodexLogEntry[] {
  const globalObject = globalThis as GlobalWithCodexLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: CodexLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<CodexLogListener> {
  const globalObject = globalThis as GlobalWithCodexLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<CodexLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: CodexLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      // Avoid surfacing subscriber errors to providers; log for visibility.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Codex log subscriber failed: ${message}`);
    }
  }
}

export function recordCodexLogEntry(entry: CodexLogEntry): void {
  getCodexLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeCodexLogEntries(): CodexLogEntry[] {
  const store = getCodexLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToCodexLogEntries(listener: CodexLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
