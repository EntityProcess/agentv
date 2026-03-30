/**
 * Studio configuration loader.
 *
 * Reads an optional `config.yaml` from the `.agentv/` directory to configure
 * AgentV Studio behavior (e.g., pass/fail threshold).
 *
 * Location: `.agentv/config.yaml`
 *
 * config.yaml format:
 *   pass_threshold: 0.8   # score >= this value is considered "pass"
 *
 * If no config.yaml exists, defaults are used.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PASS_THRESHOLD } from '@agentv/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface StudioConfig {
  pass_threshold: number;
}

const DEFAULTS: StudioConfig = {
  pass_threshold: PASS_THRESHOLD,
};

/**
 * Load studio config from `config.yaml` in the given `.agentv/` directory.
 * Returns defaults when the file does not exist or is empty.
 * Clamps `pass_threshold` to [0, 1].
 */
export function loadStudioConfig(agentvDir: string): StudioConfig {
  const configPath = path.join(agentvDir, 'config.yaml');

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

/**
 * Save studio config to `config.yaml` in the given `.agentv/` directory.
 * Creates the directory if it does not exist.
 */
export function saveStudioConfig(agentvDir: string, config: StudioConfig): void {
  if (!existsSync(agentvDir)) {
    mkdirSync(agentvDir, { recursive: true });
  }
  const configPath = path.join(agentvDir, 'config.yaml');
  const yamlStr = stringifyYaml(config);
  writeFileSync(configPath, yamlStr, 'utf-8');
}
