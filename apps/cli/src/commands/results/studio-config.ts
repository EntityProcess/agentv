/**
 * Dashboard configuration loader.
 *
 * Reads dashboard-specific settings from the `dashboard:` section of config.yaml.
 * Project-local `.agentv/config.yaml` takes precedence over the global
 * `${AGENTV_HOME:-~/.agentv}/config.yaml`, with legacy `studio:` and root-level
 * threshold keys still accepted for compatibility. Saving writes only to the
 * project-local file and preserves unrelated fields.
 *
 * config.yaml format:
 *   required_version: ">=4.2.0"
 *   dashboard:
 *     app_name: agentv # displayed in the Dashboard shell
 *     threshold: 0.8   # score >= this value is considered "pass"
 *
 * Backward compat: reads `studio.threshold`, `studio.pass_threshold`, and
 * root-level `pass_threshold` as fallbacks. On save, always writes `threshold`
 * under `dashboard:`.
 *
 * If no config.yaml exists in either location, defaults are used.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_THRESHOLD, getAgentvConfigDir, parseYamlValue } from '@agentv/core';
import { stringify as stringifyYaml } from 'yaml';

export interface StudioConfig {
  threshold: number;
  appName: string;
}

const DEFAULTS: StudioConfig = {
  threshold: DEFAULT_THRESHOLD,
  appName: 'agentv',
};

/**
 * Load dashboard config from `config.yaml` in the given `.agentv/` directory.
 * Reads from `dashboard.threshold`, falling back to `dashboard.pass_threshold`,
 * `studio.threshold`, `studio.pass_threshold`, then root-level `pass_threshold`
 * for backward compatibility.
 * Returns defaults when the file does not exist or is empty.
 * Clamps `threshold` to [0, 1].
 */
export function loadStudioConfig(agentvDir: string): StudioConfig {
  const localConfigPath = path.join(agentvDir, 'config.yaml');
  const globalConfigPath = path.join(getAgentvConfigDir(), 'config.yaml');
  const localConfig = loadParsedConfig(localConfigPath);
  const globalConfig =
    path.resolve(globalConfigPath) === path.resolve(localConfigPath)
      ? undefined
      : loadParsedConfig(globalConfigPath);

  const threshold = [
    readThreshold(localConfig?.dashboard),
    readThreshold(localConfig?.studio),
    typeof localConfig?.pass_threshold === 'number' ? localConfig.pass_threshold : undefined,
    readThreshold(globalConfig?.dashboard),
    readThreshold(globalConfig?.studio),
    typeof globalConfig?.pass_threshold === 'number' ? globalConfig.pass_threshold : undefined,
    DEFAULTS.threshold,
  ].find((value) => value !== undefined) as number;

  return {
    threshold: Math.min(1, Math.max(0, threshold)),
    appName:
      readAppName(localConfig?.dashboard) ??
      readAppName(globalConfig?.dashboard) ??
      DEFAULTS.appName,
  };
}

function loadParsedConfig(configPath: string): Record<string, unknown> | undefined {
  if (!existsSync(configPath)) return undefined;

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYamlValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

function readThreshold(section: unknown): number | undefined {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return undefined;
  const values = section as Record<string, unknown>;
  if (typeof values.threshold === 'number') return values.threshold;
  if (typeof values.pass_threshold === 'number') return values.pass_threshold;
  return undefined;
}

function readAppName(section: unknown): string | undefined {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return undefined;
  const value = (section as Record<string, unknown>).app_name;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Save dashboard config to `config.yaml` in the given `.agentv/` directory.
 * Merges into the existing file, preserving all non-dashboard fields
 * (required_version, eval_patterns, execution, etc.).
 * Writes dashboard settings under the `dashboard:` key and removes the legacy
 * `studio:` section after migrating any unknown legacy keys.
 * Creates the directory if it does not exist.
 */
export function saveStudioConfig(agentvDir: string, config: StudioConfig): void {
  if (!existsSync(agentvDir)) {
    mkdirSync(agentvDir, { recursive: true });
  }
  const configPath = path.join(agentvDir, 'config.yaml');

  // Read existing config to preserve non-dashboard fields.
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

  // Migrate legacy studio fields into dashboard while dropping legacy threshold spellings.
  const existingDashboard = existing.dashboard;
  const existingStudio = existing.studio;
  const dashboardRest =
    existingDashboard && typeof existingDashboard === 'object' && !Array.isArray(existingDashboard)
      ? (({ pass_threshold: _, ...rest }) => rest)(existingDashboard as Record<string, unknown>)
      : {};
  const studioRest =
    existingStudio && typeof existingStudio === 'object' && !Array.isArray(existingStudio)
      ? (({ threshold: _, pass_threshold: __, ...rest }) => rest)(
          existingStudio as Record<string, unknown>,
        )
      : {};

  const { studio: _legacyStudio, ...withoutStudio } = existing;
  existing = {
    ...withoutStudio,
    dashboard: {
      ...studioRest,
      ...dashboardRest,
      threshold: config.threshold,
      app_name: config.appName,
    },
  };

  const yamlStr = stringifyYaml(existing);
  writeFileSync(configPath, yamlStr, 'utf-8');
}
