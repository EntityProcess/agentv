import { stripVTControlCharacters } from 'node:util';

export interface WorkerProgress {
  workerId: number;
  evalId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  targetLabel?: string;
}

// ANSI escape sequences
const ESC = '\x1B[';
const CLEAR_LINE = `${ESC}K`;
const MOVE_CURSOR_UP = `${ESC}1A`;

export class ProgressDisplay {
  private readonly workers: Map<number, WorkerProgress> = new Map();
  private readonly maxWorkers: number;
  private totalTests = 0;
  private completedTests = 0;
  private renderTimer?: NodeJS.Timeout;
  private renderScheduled = false;
  private isInteractive: boolean;
  private readonly logPaths: string[] = [];
  private readonly logPathSet = new Set<string>();
  private hasPrintedLogHeader = false;
  private windowHeight = 0;
  private started = false;
  private finished = false;

  constructor(maxWorkers: number) {
    this.maxWorkers = maxWorkers;
    this.isInteractive = process.stdout.isTTY && !process.env.CI;
  }

  isInteractiveMode(): boolean {
    return this.isInteractive;
  }

  start(): void {
    this.started = true;
    this.finished = false;

    if (this.isInteractive) {
      // Print initial empty line for visual separation
      this.write('\n');

      // Start periodic rendering (similar to Vitest's approach)
      this.renderTimer = setInterval(() => {
        this.scheduleRender();
      }, 1000); // Update once per second

      this.renderTimer.unref?.();
    }
  }

  setTotalTests(count: number): void {
    this.totalTests = count;
  }

  updateWorker(progress: WorkerProgress): void {
    this.workers.set(progress.workerId, progress);

    if (progress.status === 'completed' || progress.status === 'failed') {
      this.completedTests++;
    }

    if (this.isInteractive) {
      this.scheduleRender();
    } else {
      // In non-interactive mode, just print completion events
      const targetSuffix = progress.targetLabel ? ` | ${progress.targetLabel}` : '';
      if (progress.status === 'completed') {
        console.log(`✓ Eval ${progress.evalId}${targetSuffix} completed`);
      } else if (progress.status === 'failed') {
        console.log(
          `✗ Eval ${progress.evalId}${targetSuffix} failed${progress.error ? `: ${progress.error}` : ''}`,
        );
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

    if (this.isInteractive) {
      this.scheduleRender();
      return;
    }

    if (!this.hasPrintedLogHeader) {
      console.log('');
      console.log('Codex CLI logs:');
      this.hasPrintedLogHeader = true;
    }

    const startIndex = this.logPaths.length - newPaths.length;
    newPaths.forEach((path, offset) => {
      console.log(`${startIndex + offset + 1}. ${path}`);
    });
  }

  private scheduleRender(): void {
    if (this.renderScheduled || this.finished) {
      return;
    }

    this.renderScheduled = true;

    // Debounce renders to 100ms to prevent rapid re-renders
    setTimeout(() => {
      this.renderScheduled = false;
      this.render();
    }, 100);
  }

  private write(content: string): void {
    process.stdout.write(content);
  }

  private clearWindow(): void {
    if (this.windowHeight === 0) {
      return;
    }

    // Move cursor to start of line and clear it
    this.write(`\r${CLEAR_LINE}`);

    // Move up and clear each line
    for (let i = 1; i < this.windowHeight; i++) {
      this.write(`${MOVE_CURSOR_UP}\r${CLEAR_LINE}`);
    }

    this.windowHeight = 0;
  }

  private getRenderedRowCount(rows: string[]): number {
    const columns = process.stdout.columns || 80;
    let count = 0;

    for (const row of rows) {
      const text = stripVTControlCharacters(row);
      count += Math.max(1, Math.ceil(text.length / columns));
    }

    return count;
  }

  private render(): void {
    if (!this.isInteractive || !this.started || this.finished) {
      return;
    }

    const lines: string[] = [];

    // Worker status lines
    const sortedWorkers = Array.from(this.workers.values()).sort((a, b) => a.workerId - b.workerId);
    for (const worker of sortedWorkers) {
      const line = this.formatWorkerLine(worker);
      lines.push(line);
    }

    if (this.logPaths.length > 0) {
      lines.push('');
      lines.push('Codex CLI logs:');
      this.logPaths.forEach((path, index) => {
        lines.push(`${index + 1}. ${path}`);
      });
    }

    // Calculate row count for accurate clearing
    const rowCount = this.getRenderedRowCount(lines);

    // Clear and redraw without synchronized updates (to avoid Windows Terminal issues)
    this.clearWindow();

    if (lines.length > 0) {
      this.write(lines.join('\n'));
    }

    this.windowHeight = rowCount;
  }

  private formatWorkerLine(worker: WorkerProgress): string {
    const workerLabel = `${worker.workerId}.`.padEnd(4);
    const statusIcon = this.getStatusIcon(worker.status);
    const targetLabel = worker.targetLabel ? `  | ${worker.targetLabel}` : '';

    const columns = process.stdout.columns || 80;
    // Leave a small buffer to prevent accidental wrapping at the edge
    const maxLineLength = Math.max(40, columns - 4);

    const reservedLength = workerLabel.length + statusIcon.length + targetLabel.length + 4; // spaces and separators
    const availableLabelLength = Math.max(15, maxLineLength - reservedLength);

    let testLabel = worker.evalId;
    if (testLabel.length > availableLabelLength) {
      testLabel = `${testLabel.substring(0, Math.max(0, availableLabelLength - 3))}...`;
    }

    return `${workerLabel} ${statusIcon} ${testLabel}${targetLabel}`;
  }

  private getStatusIcon(status: WorkerProgress['status']): string {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'running':
        return '🔄';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '  ';
    }
  }

  finish(): void {
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = undefined;
    }

    this.finished = true;

    if (this.isInteractive && this.started) {
      // Clear the dynamic window completely
      this.clearWindow();

      // Write final state as permanent output (not a window)
      const sortedWorkers = Array.from(this.workers.values()).sort(
        (a, b) => a.workerId - b.workerId,
      );
      for (const worker of sortedWorkers) {
        this.write(`${this.formatWorkerLine(worker)}\n`);
      }

      // Add blank line to separate from summary
      this.write('\n');
    }
  }

  clear(): void {
    if (this.isInteractive) {
      this.clearWindow();
    }
  }
}
