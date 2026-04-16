/**
 * Tracks cumulative cost across all eval files in a single CLI run.
 *
 * The per-suite budget (`execution.budget_usd` in YAML) is enforced by the orchestrator
 * and caps spend within one eval file. This tracker provides a **run-level** cap that
 * spans all files in a single `agentv run` invocation.
 *
 * Usage:
 * 1. Instantiate with the cap from `--budget-usd`.
 * 2. Share the tracker with each orchestrator running in the invocation.
 * 3. After each completed case, call `add()` with that case's total cost.
 * 4. Before dispatching the next case or file, check `isExceeded()`.
 *
 * Thread-safety note: AgentV mutates this tracker from async orchestration code, but all
 * updates occur on the JavaScript event loop. There is no shared-memory mutation across
 * threads, so simple cumulative accounting is sufficient here.
 */
export class RunBudgetTracker {
  private cumulative = 0;

  constructor(private readonly capUsd: number) {}

  /** Accumulate cost from a completed test or file. */
  add(costUsd: number): void {
    this.cumulative += costUsd;
  }

  /** True when cumulative cost meets or exceeds the cap. */
  isExceeded(): boolean {
    return this.cumulative >= this.capUsd;
  }

  /** Current accumulated cost. */
  get currentCostUsd(): number {
    return this.cumulative;
  }

  /** The configured cap. */
  get budgetCapUsd(): number {
    return this.capUsd;
  }
}
