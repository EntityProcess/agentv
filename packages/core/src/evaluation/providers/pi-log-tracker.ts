export type PiLogEntry = {
  readonly filePath: string;
  readonly evalCaseId?: string;
  readonly targetName: string;
  readonly attempt?: number;
};

const GLOBAL_LOGS_KEY = Symbol.for('agentv.piLogs');
const GLOBAL_SUBSCRIBERS_KEY = Symbol.for('agentv.piLogSubscribers');

type PiLogListener = (entry: PiLogEntry) => void;

type GlobalWithPiLogs = typeof globalThis & {
  [GLOBAL_LOGS_KEY]?: PiLogEntry[];
  [GLOBAL_SUBSCRIBERS_KEY]?: Set<PiLogListener>;
};

function getPiLogStore(): PiLogEntry[] {
  const globalObject = globalThis as GlobalWithPiLogs;
  const existing = globalObject[GLOBAL_LOGS_KEY];
  if (existing) {
    return existing;
  }
  const created: PiLogEntry[] = [];
  globalObject[GLOBAL_LOGS_KEY] = created;
  return created;
}

function getSubscriberStore(): Set<PiLogListener> {
  const globalObject = globalThis as GlobalWithPiLogs;
  const existing = globalObject[GLOBAL_SUBSCRIBERS_KEY];
  if (existing) {
    return existing;
  }
  const created = new Set<PiLogListener>();
  globalObject[GLOBAL_SUBSCRIBERS_KEY] = created;
  return created;
}

function notifySubscribers(entry: PiLogEntry): void {
  const subscribers = Array.from(getSubscriberStore());
  for (const listener of subscribers) {
    try {
      listener(entry);
    } catch (error) {
      // Avoid surfacing subscriber errors to providers; log for visibility.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Pi log subscriber failed: ${message}`);
    }
  }
}

export function recordPiLogEntry(entry: PiLogEntry): void {
  getPiLogStore().push(entry);
  notifySubscribers(entry);
}

export function consumePiLogEntries(): PiLogEntry[] {
  const store = getPiLogStore();
  if (store.length === 0) {
    return [];
  }
  return store.splice(0, store.length);
}

export function subscribeToPiLogEntries(listener: PiLogListener): () => void {
  const store = getSubscriberStore();
  store.add(listener);
  return () => {
    store.delete(listener);
  };
}
