/**
 * Studio configuration loader.
 *
 * Reads studio-specific settings from the `studio:` section of
 * `.agentv/config.yaml`. Preserves all other fields (required_version,
 * eval_patterns, execution, etc.) when saving.
 *
 * Location: `.agentv/config.yaml`
 *
 * config.yaml format:
 *   required_version: ">=4.2.0"
 *   studio:
 *     pass_threshold: 0.8   # score >= this value is considered "pass"
 *
 * Backward compat: reads root-level `pass_threshold` if `studio:` section
 * is absent (legacy format). On save, always writes under `studio:`.
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
 * Reads from `studio.pass_threshold`, falling back to root-level
 * `pass_threshold` for backward compatibility.
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

  // Prefer studio.pass_threshold, fall back to root-level pass_threshold (legacy)
  const studio = (parsed as Record<string, unknown>).studio;
  let threshold = DEFAULTS.pass_threshold;
  if (studio && typeof studio === 'object' && !Array.isArray(studio)) {
    const studioThreshold = (studio as Record<string, unknown>).pass_threshold;
    if (typeof studioThreshold === 'number') {
      threshold = studioThreshold;
    }
  } else if (typeof (parsed as Record<string, unknown>).pass_threshold === 'number') {
    threshold = (parsed as Record<string, unknown>).pass_threshold as number;
  }

  return {
    pass_threshold: Math.min(1, Math.max(0, threshold)),
  };
}

/**
 * Save studio config to `config.yaml` in the given `.agentv/` directory.
 * Merges into the existing file, preserving all non-studio fields
 * (required_version, eval_patterns, execution, etc.).
 * Writes studio settings under the `studio:` key.
 * Creates the directory if it does not exist.
 */
export function saveStudioConfig(agentvDir: string, config: StudioConfig): void {
  if (!existsSync(agentvDir)) {
    mkdirSync(agentvDir, { recursive: true });
  }
  const configPath = path.join(agentvDir, 'config.yaml');

  // Read existing config to preserve non-studio fields
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }

  // Remove legacy root-level pass_threshold
  delete existing.pass_threshold;

  // Merge studio section
  existing.studio = { ...config };

  const yamlStr = stringifyYaml(existing);
  writeFileSync(configPath, yamlStr, 'utf-8');
}
