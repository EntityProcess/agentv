export type CopilotCliLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.copilotCliLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.copilotCliLogSubscribers');

type CopilotCliLogListener = (entry: CopilotCliLogEntry) => void;

type GlobalWithCopilotCliLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: CopilotCliLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<CopilotCliLogListener>;
};

function getCopilotCliLogStore(): CopilotCliLogEntry[] {
  const globalObject = globalThis as GlobalWithCopilotCliLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: CopilotCliLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<CopilotCliLogListener> {
  const globalObject = globalThis as GlobalWithCopilotCliLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<CopilotCliLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: CopilotCliLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Copilot CLI log subscriber failed: ${message}`);
    }
  }
}

export function recordCopilotCliLogEntry(entry: CopilotCliLogEntry): void {
  getCopilotCliLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeCopilotCliLogEntries(): CopilotCliLogEntry[] {
  const store = getCopilotCliLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToCopilotCliLogEntries(
  listener: CopilotCliLogListener,
): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
