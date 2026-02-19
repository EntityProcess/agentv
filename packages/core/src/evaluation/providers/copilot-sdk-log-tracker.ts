export type CopilotSdkLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.copilotSdkLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.copilotSdkLogSubscribers');

type CopilotSdkLogListener = (entry: CopilotSdkLogEntry) => void;

type GlobalWithCopilotSdkLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: CopilotSdkLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<CopilotSdkLogListener>;
};

function getCopilotSdkLogStore(): CopilotSdkLogEntry[] {
  const globalObject = globalThis as GlobalWithCopilotSdkLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: CopilotSdkLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<CopilotSdkLogListener> {
  const globalObject = globalThis as GlobalWithCopilotSdkLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<CopilotSdkLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: CopilotSdkLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Copilot SDK log subscriber failed: ${message}`);
    }
  }
}

export function recordCopilotSdkLogEntry(entry: CopilotSdkLogEntry): void {
  getCopilotSdkLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumeCopilotSdkLogEntries(): CopilotSdkLogEntry[] {
  const store = getCopilotSdkLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToCopilotSdkLogEntries(listener: CopilotSdkLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
