/**
 * Tracks cumulative cost across all eval files in a single CLI run.
 *
 * The per-suite budget (`execution.budget_usd` in YAML) is enforced by the orchestrator
 * and caps spend within one eval file. This tracker provides a **run-level** cap that
 * spans all files in a single `agentv run` invocation.
 *
 * Usage:
 * 1. Instantiate with the cap from `--budget-usd`.
 * 2. After each file's results come back, call `add()` with the file's total cost.
 * 3. Before dispatching the next file, check `isExceeded()`.
 *
 * Thread-safety note: eval files run sequentially, so no concurrent mutation occurs.
 * Within a file, the orchestrator's own budget tracking handles concurrency.
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
