import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveSkillRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, '..');
}

export function resolveAgentvCommand(): string[] {
  return ['agentv'];
}

export function isAgentvCliAvailable(): { available: boolean; reason?: string } {
  try {
    execSync('agentv --version', { stdio: 'ignore', timeout: 5000 });
    return { available: true };
  } catch {
    return {
      available: false,
      reason: 'agentv binary not found in PATH. Install with: npm install -g agentv',
    };
  }
}
