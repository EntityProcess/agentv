import { addTask, listTasks } from '../services/task-service';
import { formatTask } from '../utils/format-task';

/**
 * API handler — mirrors CLI functionality over HTTP.
 * Both entry points share the same service layer.
 */
export function handleRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): { status: number; body: unknown } {
  if (method === 'GET' && path === '/tasks') {
    const tasks = listTasks();
    return { status: 200, body: tasks.map(formatTask) };
  }

  if (method === 'POST' && path === '/tasks') {
    const title = body?.title as string;
    if (!title) return { status: 400, body: { error: 'title is required' } };
    const task = addTask(title);
    return { status: 201, body: task };
  }

  return { status: 404, body: { error: 'not found' } };
}
