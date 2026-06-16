import { coerce, satisfies, validRange } from 'semver';

import packageJson from '../package.json' with { type: 'json' };

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[0m';

export interface VersionCheckResult {
  readonly satisfied: boolean;
  readonly currentVersion: string;
  readonly requiredRange: string;
}

/**
 * Advisory version checks for project `required_version`.
 *
 * A mismatched installed version never prompts, self-updates, or exits by
 * default. Commands may print the returned warning to help users diagnose
 * failures, while explicit `--strict` callers can still opt into a hard gate.
 * Malformed ranges remain configuration errors.
 */
export function checkVersion(requiredVersion: string): VersionCheckResult {
  const currentVersion = packageJson.version;

  if (!requiredVersion.trim() || !validRange(requiredVersion)) {
    throw new Error(
      `Invalid required_version "${requiredVersion}" in .agentv/config.yaml. Must be a valid semver range (e.g., ">=2.11.0", "^2.11.0").`,
    );
  }

  return {
    satisfied: satisfies(coerce(currentVersion) ?? currentVersion, requiredVersion),
    currentVersion,
    requiredRange: requiredVersion,
  };
}

function formatVersionMismatch(result: VersionCheckResult): string {
  return `agentv ${result.currentVersion} does not satisfy this project's required_version ${result.requiredRange}`;
}

export function formatRequiredVersionWarning(result: VersionCheckResult): string {
  return `${ANSI_YELLOW}Warning: ${formatVersionMismatch(result)}. Run \`agentv self update\`.${ANSI_RESET}`;
}

export function formatRequiredVersionFailureNote(result: VersionCheckResult): string {
  return `note: ${formatVersionMismatch(result)} - this may be the cause. Run \`agentv self update\`.`;
}

/**
 * Run the version compatibility check.
 *
 * - If the version satisfies the range, returns the satisfied result silently.
 * - If the range is malformed, prints an error and exits with code 1.
 * - If the version is below the range, warns to stderr and continues.
 * - Strict mode remains an explicit opt-in hard failure.
 */
export function enforceRequiredVersion(
  requiredVersion: string,
  options?: { strict?: boolean },
): VersionCheckResult {
  let result: VersionCheckResult;
  try {
    result = checkVersion(requiredVersion);
  } catch (err) {
    console.error(`${ANSI_RED}Error: ${(err as Error).message}${ANSI_RESET}`);
    process.exit(1);
  }

  if (result.satisfied) {
    return result;
  }

  const warning = formatRequiredVersionWarning(result);

  if (options?.strict) {
    console.error(warning);
    console.error(
      `${ANSI_RED}Aborting: --strict mode requires the installed version to satisfy the required range.${ANSI_RESET}`,
    );
    process.exit(1);
  }

  process.stderr.write(`${warning}\n`);
  return result;
}
