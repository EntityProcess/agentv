import type { Task } from '../models/task';

/**
 * Shared utility used by CLI, API, and reports.
 * Format a task for display output.
 */
export function formatTask(task: Task): string {
  const statusIcon = task.status === 'done' ? '✓' : task.status === 'in_progress' ? '→' : '○';
  return `${statusIcon} [${task.id}] ${task.title}`;
}

/**
 * Partial implementation of priority derivation.
 * Currently only handles basic cases — does not support custom priority rules.
 */
export function derivePriority(task: Task): 'high' | 'medium' | 'low' {
  if (task.status === 'in_progress') return 'high';
  return 'medium';
}
