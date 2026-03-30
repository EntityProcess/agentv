/**
 * Studio configuration loader.
 *
 * Reads an optional `config.yaml` from the runs directory to configure
 * AgentV Studio behavior (e.g., pass/fail threshold).
 *
 * config.yaml format:
 *   pass_threshold: 0.8   # score >= this value is considered "pass"
 *
 * If no config.yaml exists, defaults are used.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PASS_THRESHOLD } from '@agentv/core';
import { parse as parseYaml } from 'yaml';

export interface StudioConfig {
  pass_threshold: number;
}

const DEFAULTS: StudioConfig = {
  pass_threshold: PASS_THRESHOLD,
};

/**
 * Load studio config from `config.yaml` in the given runs directory.
 * Returns defaults when the file does not exist or is empty.
 * Clamps `pass_threshold` to [0, 1].
 */
export function loadStudioConfig(runsDir: string): StudioConfig {
  const configPath = path.join(runsDir, 'config.yaml');

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULTS };
  }

  const threshold =
    typeof parsed.pass_threshold === 'number' ? parsed.pass_threshold : DEFAULTS.pass_threshold;

  return {
    pass_threshold: Math.min(1, Math.max(0, threshold)),
  };
}
