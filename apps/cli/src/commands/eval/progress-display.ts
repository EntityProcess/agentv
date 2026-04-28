export type Verdict = 'PASS' | 'FAIL' | 'ERROR';

export interface WorkerProgress {
  workerId: number;
  testId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  targetLabel?: string;
  score?: number;
  verdict?: Verdict;
  durationMs?: number;
  totalDurationMs?: number;
}

const ANSI_BOLD = '\x1b[1m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RESET = '\x1b[0m';

function useColors(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY ?? false;
}

function formatVerdict(score: number | undefined, verdict: Verdict | undefined): string {
  if (verdict === undefined) return '';

  const colors = useColors();
  const scoreStr = score !== undefined ? `${Math.round(score * 100)}%` : '';
  const verdictLabel = verdict === 'ERROR' ? 'ERROR' : `${scoreStr} ${verdict}`;

  if (!colors) return ` | ${verdictLabel}`;

  const color = verdict === 'PASS' ? ANSI_GREEN : verdict === 'FAIL' ? ANSI_RED : ANSI_YELLOW;

  return ` | ${color}${ANSI_BOLD}${verdictLabel}${ANSI_RESET}`;
}

function formatDurations(
  durationMs: number | undefined,
  totalDurationMs: number | undefined,
): string {
  if (durationMs === undefined && totalDurationMs === undefined) {
    return '';
  }

  if (durationMs !== undefined && totalDurationMs !== undefined) {
    const normalizedTotalMs = Math.max(durationMs, totalDurationMs);
    return ` | τ ${durationMs}/${normalizedTotalMs}ms`;
  }

  const singleDurationMs = durationMs ?? totalDurationMs;
  return singleDurationMs !== undefined ? ` | τ ${singleDurationMs}ms` : '';
}

/**
 * Simple line-based progress display.
 * Prints each status update as a new line - no ANSI cursor manipulation.
 * This ensures compatibility with verbose logging from providers.
 */
export class ProgressDisplay {
  private readonly workers: Map<number, WorkerProgress> = new Map();
  private totalTests = 0;
  private completedTests = 0;
  private readonly logPaths: string[] = [];
  private readonly logPathSet = new Set<string>();
  private started = false;
  private finished = false;
  private readonly verbose: boolean;

  constructor(_maxWorkers: number, options?: { verbose?: boolean }) {
    this.verbose = options?.verbose ?? false;
  }

  isInteractiveMode(): boolean {
    // Always return false - we use simple line-based output
    return false;
  }

  start(): void {
    this.started = true;
    this.finished = false;
  }

  setTotalTests(count: number): void {
    this.totalTests = count;
  }

  updateWorker(progress: WorkerProgress): void {
    const previous = this.workers.get(progress.workerId);
    this.workers.set(progress.workerId, progress);

    if (progress.status === 'completed' || progress.status === 'failed') {
      this.completedTests++;
    }

    // Print status updates as simple lines
    const targetSuffix = progress.targetLabel ? ` | ${progress.targetLabel}` : '';
    const countPrefix = `${this.completedTests}/${this.totalTests}`;

    switch (progress.status) {
      case 'pending':
        // Only print pending in verbose mode (just shows the queue)
        if (this.verbose && !previous) {
          console.log(`${countPrefix}   ⏳ ${progress.testId}${targetSuffix}`);
        }
        break;
      case 'running':
        // Always print running - useful feedback for long-running agents
        if (!previous || previous.status === 'pending') {
          console.log(`${countPrefix}   🔄 ${progress.testId}${targetSuffix}`);
        }
        break;
      case 'completed': {
        // Pick icon based on verdict: ✅ PASS, ⚠️ FAIL, ❌ ERROR
        const icon = progress.verdict === 'FAIL' ? '⚠️' : progress.verdict === 'ERROR' ? '❌' : '✅';
        console.log(
          `${countPrefix}   ${icon} ${progress.testId}${targetSuffix}${formatVerdict(progress.score, progress.verdict)}${formatDurations(progress.durationMs, progress.totalDurationMs)}`,
        );
        break;
      }
      case 'failed': {
        const failIcon = progress.verdict === 'ERROR' ? '❌' : '⚠️';
        console.log(
          `${countPrefix}   ${failIcon} ${progress.testId}${targetSuffix}${formatVerdict(progress.score, progress.verdict)}${formatDurations(progress.durationMs, progress.totalDurationMs)}${progress.error ? `: ${progress.error}` : ''}`,
        );
        break;
      }
    }
  }

  addLogPaths(paths: readonly string[]): void {
    const newPaths: string[] = [];
    for (const path of paths) {
      if (this.logPathSet.has(path)) {
        continue;
      }
      this.logPathSet.add(path);
      newPaths.push(path);
    }

    if (newPaths.length === 0) {
      return;
    }

    this.logPaths.push(...newPaths);

    for (const p of newPaths) {
      console.log(`Provider log: ${p}`);
    }
  }

  finish(): void {
    this.finished = true;
    // Add blank line to separate from summary
    console.log('');
  }

  clear(): void {
    // No-op for line-based display
  }
}
