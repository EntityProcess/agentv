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
  const scoreStr = score !== undefined ? score.toFixed(3) : '';
  const verdictLabel = verdict === 'ERROR' ? 'ERROR' : `${scoreStr} ${verdict}`;

  if (!colors) return ` | ${verdictLabel}`;

  const color = verdict === 'PASS' ? ANSI_GREEN : verdict === 'FAIL' ? ANSI_RED : ANSI_YELLOW;

  return ` | ${color}${ANSI_BOLD}${verdictLabel}${ANSI_RESET}`;
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
  private hasPrintedLogHeader = false;
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
      case 'completed':
        console.log(
          `${countPrefix}   ✅ ${progress.testId}${targetSuffix}${formatVerdict(progress.score, progress.verdict)}`,
        );
        break;
      case 'failed':
        console.log(
          `${countPrefix}   ❌ ${progress.testId}${targetSuffix}${formatVerdict(progress.score, progress.verdict)}${progress.error ? `: ${progress.error}` : ''}`,
        );
        break;
    }
  }

  addLogPaths(paths: readonly string[], provider?: 'codex' | 'pi' | 'copilot'): void {
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

    if (!this.hasPrintedLogHeader) {
      console.log('');
      const label =
        provider === 'pi'
          ? 'Pi Coding Agent'
          : provider === 'copilot'
            ? 'Copilot CLI'
            : 'Codex CLI';
      console.log(`${label} logs:`);
      this.hasPrintedLogHeader = true;
    }

    const startIndex = this.logPaths.length - newPaths.length;
    newPaths.forEach((path, offset) => {
      console.log(`${startIndex + offset + 1}. ${path}`);
    });
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
