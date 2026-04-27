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
 *     threshold: 0.8   # score >= this value is considered "pass"
 *
 * Backward compat: reads `studio.pass_threshold` and root-level `pass_threshold`
 * as fallback. On save, always writes `threshold` under `studio:`.
 *
 * If no config.yaml exists, defaults are used.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_THRESHOLD, parseYamlValue } from '@agentv/core';
import { stringify as stringifyYaml } from 'yaml';

export interface StudioConfig {
  threshold: number;
}

const DEFAULTS: StudioConfig = {
  threshold: DEFAULT_THRESHOLD,
};

/**
 * Load studio config from `config.yaml` in the given `.agentv/` directory.
 * Reads from `studio.threshold`, falling back to `studio.pass_threshold` (legacy),
 * then root-level `pass_threshold` (legacy) for backward compatibility.
 * Returns defaults when the file does not exist or is empty.
 * Clamps `threshold` to [0, 1].
 */
export function loadStudioConfig(agentvDir: string): StudioConfig {
  const configPath = path.join(agentvDir, 'config.yaml');

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYamlValue(raw);

  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULTS };
  }

  // Prefer studio.threshold, fall back to studio.pass_threshold, then root-level pass_threshold
  const studio = (parsed as Record<string, unknown>).studio;
  let threshold = DEFAULTS.threshold;
  if (studio && typeof studio === 'object' && !Array.isArray(studio)) {
    const studioObj = studio as Record<string, unknown>;
    if (typeof studioObj.threshold === 'number') {
      threshold = studioObj.threshold;
    } else if (typeof studioObj.pass_threshold === 'number') {
      threshold = studioObj.pass_threshold;
    }
  } else if (typeof (parsed as Record<string, unknown>).pass_threshold === 'number') {
    threshold = (parsed as Record<string, unknown>).pass_threshold as number;
  }

  return {
    threshold: Math.min(1, Math.max(0, threshold)),
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
    const parsed = parseYamlValue(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }

  // Remove legacy root-level pass_threshold
  const { pass_threshold: _, ...rest } = existing;
  existing = rest;

  // Clean legacy pass_threshold from studio section if present
  const existingStudio = existing.studio;
  if (existingStudio && typeof existingStudio === 'object' && !Array.isArray(existingStudio)) {
    const { pass_threshold: __, ...studioRest } = existingStudio as Record<string, unknown>;
    existing.studio = { ...studioRest, ...config };
  } else {
    existing.studio = { ...config };
  }

  const yamlStr = stringifyYaml(existing);
  writeFileSync(configPath, yamlStr, 'utf-8');
}
