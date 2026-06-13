/**
 * WIP (work-in-progress) checkpoint loop for in-progress eval runs.
 *
 * Periodically force-pushes the partial run output directory to a unique
 * non-default branch (`agentv/inflight/<hostname>/<run-dir-basename>`) in the
 * configured results repository. This protects against pod/process loss by
 * keeping completed-test results durable without requiring PVC or S3.
 *
 * Branch lifecycle:
 *   1. Start:   set up a persistent git worktree for the WIP branch.
 *   2. Running: every ~30s, copy run dir → worktree, amend-commit, force-push.
 *   3. Success: after final publish to the normal results branch, delete the WIP branch.
 *   4. Failure: leave the WIP branch for manual recovery.
 *
 * Manual recovery from a WIP branch:
 *   git clone <results-repo> /tmp/recovery
 *   cd /tmp/recovery && git checkout agentv/inflight/<hostname>/<run-dir>
 *   cp -r .agentv/results/runs/<run-dir> <project>/.agentv/results/runs/
 *   agentv eval <eval-file> --output <project>/.agentv/results/runs/<run-dir> --resume
 *
 * All checkpoint operations are best-effort: failures are logged as warnings
 * and never propagate to the eval run.
 */

import {
  type NormalizedResultsConfig,
  type WipWorktreeHandle,
  buildWipBranchName,
  deleteWipBranch,
  pushWipCheckpoint,
  setupWipWorktree,
} from '@agentv/core';

const WIP_CHECKPOINT_INTERVAL_MS = 30_000;

export interface WipCheckpointLoopDependencies {
  readonly buildWipBranchName: (runDir: string) => string;
  readonly deleteWipBranch: typeof deleteWipBranch;
  readonly pushWipCheckpoint: typeof pushWipCheckpoint;
  readonly setupWipWorktree: typeof setupWipWorktree;
}

const defaultDependencies: WipCheckpointLoopDependencies = {
  buildWipBranchName,
  deleteWipBranch,
  pushWipCheckpoint,
  setupWipWorktree,
};

function warnCheckpointError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`WIP checkpoint: ${context}: ${message}`);
}

export class WipCheckpointLoop {
  readonly wipBranch: string;
  private readonly config: NormalizedResultsConfig;
  private readonly runDir: string;
  private readonly destinationPath: string;
  private readonly intervalMs: number;
  private readonly deps: WipCheckpointLoopDependencies;
  private handle: WipWorktreeHandle | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checkpointInFlight: Promise<void> | undefined;
  private active = false;

  constructor(params: {
    readonly config: NormalizedResultsConfig;
    readonly runDir: string;
    readonly destinationPath: string;
    readonly intervalMs?: number;
    readonly dependencies?: WipCheckpointLoopDependencies;
  }) {
    this.config = params.config;
    this.runDir = params.runDir;
    this.destinationPath = params.destinationPath;
    this.intervalMs = params.intervalMs ?? WIP_CHECKPOINT_INTERVAL_MS;
    this.deps = params.dependencies ?? defaultDependencies;
    this.wipBranch = this.deps.buildWipBranchName(params.runDir);
  }

  async start(): Promise<void> {
    try {
      this.handle = await this.deps.setupWipWorktree({
        config: this.config,
        wipBranch: this.wipBranch,
      });
    } catch (err) {
      warnCheckpointError('failed to set up WIP worktree', err);
      return;
    }
    this.active = true;
    this.timer = setInterval(() => {
      this.runCheckpointIfIdle();
    }, this.intervalMs);
    // Unref so the timer never prevents process exit.
    this.timer.unref?.();
  }

  private runCheckpointIfIdle(): void {
    if (!this.active || this.checkpointInFlight) return;
    this.checkpointInFlight = this.checkpoint()
      .catch((err) => warnCheckpointError('push failed', err))
      .finally(() => {
        this.checkpointInFlight = undefined;
      });
  }

  private async checkpoint(): Promise<void> {
    if (!this.handle) return;
    await this.deps.pushWipCheckpoint({
      handle: this.handle,
      sourceDir: this.runDir,
      destinationPath: this.destinationPath,
    });
  }

  /** Stop the loop and clean up the local worktree. Does NOT delete the remote WIP branch. */
  async stop(): Promise<void> {
    this.active = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.checkpointInFlight;
    if (this.handle) {
      await this.handle
        .cleanup()
        .catch((err) => warnCheckpointError('worktree cleanup failed', err));
      this.handle = undefined;
    }
  }

  /**
   * Stop the loop and delete the remote WIP branch.
   * Call after a successful run to keep the results repo tidy.
   */
  async stopAndDeleteWipBranch(): Promise<void> {
    await this.stop();
    try {
      await this.deps.deleteWipBranch({ config: this.config, wipBranch: this.wipBranch });
    } catch (err) {
      warnCheckpointError(`failed to delete remote branch ${this.wipBranch}`, err);
    }
  }
}
