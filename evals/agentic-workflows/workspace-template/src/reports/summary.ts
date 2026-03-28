import { listTasks } from '../services/task-service';
import { formatTask } from '../utils/format-task';

/**
 * Third consumer of formatTask — generates a summary report.
 */
export function generateSummary(): string {
  const tasks = listTasks();
  const lines = [`Task Summary (${tasks.length} total)`, '---', ...tasks.map(formatTask)];
  return lines.join('\n');
}
