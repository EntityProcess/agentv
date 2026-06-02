import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveAgentVRoot(input?: string): string {
  const configured = input ?? process.env.AGENTV_ROOT ?? defaultAgentVRoot();
  return path.resolve(configured);
}

function defaultAgentVRoot(): string {
  for (const candidate of ['../agentv', '../../agentv']) {
    if (existsSync(path.resolve(candidate, 'examples'))) return candidate;
  }
  return '../agentv';
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function relativePosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to));
}
