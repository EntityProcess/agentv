/**
 * Tracks long-lived child processes spawned by AgentV providers so that a
 * top-level signal handler can kill them all on Ctrl+C / SIGTERM.
 *
 * Why this exists: when the CLI receives SIGTERM (e.g. from Studio's Stop
 * button), Node exits the parent process but does NOT propagate the signal
 * to grandchildren. Without tracking, the spawned `claude`, `codex`, `pi`,
 * `copilot` subprocesses linger as orphans. The CLI's signal handler walks
 * this set and SIGTERMs each one before exiting.
 *
 * To extend: any provider that spawns a long-lived subprocess should call
 * `trackChild(child)` immediately after `spawn(...)`. No untrack call is
 * required — `kill()` is a no-op on dead PIDs and the registry lives only
 * for the duration of one CLI invocation.
 *
 * Why a structural `Killable` type instead of `ChildProcess`: importing
 * the real type from `node:child_process` triggers a rollup-plugin-dts
 * resolution failure when this module's signatures are re-exported from
 * the package entry. The structural shape avoids that, and any
 * `ChildProcess` satisfies it.
 */

type Killable = {
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'close', listener: (...args: unknown[]) => void): unknown;
};

const tracked = new Set<Killable>();

export function trackChild(child: Killable): void {
  tracked.add(child);
  child.once('close', () => {
    tracked.delete(child);
  });
}

export function killAllTrackedChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const child of tracked) {
    try {
      child.kill(signal);
    } catch {
      // Already dead or unable to signal; nothing to do.
    }
  }
}

export function trackedChildCount(): number {
  return tracked.size;
}
