import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const AGENTV_DIR = path.join(homedir(), '.agentv');
const LAST_CONFIG_PATH = path.join(AGENTV_DIR, 'last-config.json');

export interface LastConfig {
  readonly timestamp: string;
  readonly cwd: string;
  readonly evalPaths: readonly string[];
  readonly target: string;
  readonly workers: number;
  readonly dryRun: boolean;
  readonly cache: boolean;
}

export async function loadLastConfig(): Promise<LastConfig | undefined> {
  try {
    const content = await readFile(LAST_CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as LastConfig;
  } catch {
    return undefined;
  }
}

export async function saveLastConfig(config: LastConfig): Promise<void> {
  await mkdir(AGENTV_DIR, { recursive: true });
  await writeFile(LAST_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
