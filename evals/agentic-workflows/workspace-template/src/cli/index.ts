import { addTask, getFormattedTasks } from '../services/task-service';
import { formatTask } from '../utils/format-task';

export function runCli(args: string[]): string {
  const [command, ...rest] = args;

  switch (command) {
    case 'add': {
      const task = addTask(rest.join(' '));
      return `Created: ${formatTask(task)}`;
    }
    case 'list':
      return getFormattedTasks().join('\n') || 'No tasks found.';
    default:
      return 'Usage: task-tracker [add|list] [args...]';
  }
}
