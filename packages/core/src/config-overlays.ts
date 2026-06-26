import path from 'node:path';

export const AGENTV_CONFIG_FILE_NAME = 'config.yaml';
export const AGENTV_CONFIG_YML_FILE_NAME = 'config.yml';
export const AGENTV_LOCAL_CONFIG_FILE_NAME = 'config.local.yaml';
export const AGENTV_LOCAL_CONFIG_YML_FILE_NAME = 'config.local.yml';

export function getLocalConfigPath(configPath: string): string {
  const basename = path.basename(configPath);
  const localName =
    basename === AGENTV_CONFIG_YML_FILE_NAME
      ? AGENTV_LOCAL_CONFIG_YML_FILE_NAME
      : AGENTV_LOCAL_CONFIG_FILE_NAME;
  return path.join(path.dirname(configPath), localName);
}

export function isAgentVConfigFileName(basename: string): boolean {
  return (
    basename === AGENTV_CONFIG_FILE_NAME ||
    basename === AGENTV_CONFIG_YML_FILE_NAME ||
    basename === AGENTV_LOCAL_CONFIG_FILE_NAME ||
    basename === AGENTV_LOCAL_CONFIG_YML_FILE_NAME
  );
}

export function isPlainConfigObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function mergeConfigObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];
    merged[key] =
      isPlainConfigObject(baseValue) && isPlainConfigObject(overlayValue)
        ? mergeConfigObjects(baseValue, overlayValue)
        : overlayValue;
  }
  return merged;
}
