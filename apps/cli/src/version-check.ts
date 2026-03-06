import { satisfies, validRange } from 'semver';

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
 * Validate and check the installed version against a required semver range.
 * Throws on malformed range strings.
 */
export function checkVersion(requiredVersion: string): VersionCheckResult {
  const currentVersion = packageJson.version;

  if (!requiredVersion.trim() || !validRange(requiredVersion)) {
    throw new Error(
      `Invalid required_version "${requiredVersion}" in .agentv/config.yaml. Must be a valid semver range (e.g., ">=2.11.0", "^2.11.0").`,
    );
  }

  return {
    satisfied: satisfies(currentVersion, requiredVersion),
    currentVersion,
    requiredRange: requiredVersion,
  };
}

/**
 * Run the version compatibility check and handle user interaction.
 *
 * - If the version satisfies the range, returns silently.
 * - If the range is malformed, prints an error and exits with code 1.
 * - If the version is below the range:
 *   - Interactive (TTY): warns and prompts to continue or abort.
 *   - Non-interactive: warns to stderr, continues (unless strict).
 *   - Strict mode: warns and exits with code 1.
 */
export async function enforceRequiredVersion(
  requiredVersion: string,
  options?: { strict?: boolean },
): Promise<void> {
  let result: VersionCheckResult;
  try {
    result = checkVersion(requiredVersion);
  } catch (err) {
    console.error(`${ANSI_RED}Error: ${(err as Error).message}${ANSI_RESET}`);
    process.exit(1);
  }

  if (result.satisfied) {
    return;
  }

  const warning = `${ANSI_YELLOW}Warning: This project requires agentv ${result.requiredRange} but you have ${result.currentVersion}.${ANSI_RESET}\n  Run \`agentv self update\` to upgrade.`;

  if (options?.strict) {
    console.error(warning);
    console.error(
      `${ANSI_RED}Aborting: --strict mode requires the installed version to satisfy the required range.${ANSI_RESET}`,
    );
    process.exit(1);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    console.warn(warning);
    const shouldContinue = await promptContinue();
    if (!shouldContinue) {
      process.exit(1);
    }
  } else {
    // Non-interactive: warn to stderr and continue
    process.stderr.write(`${warning}\n`);
  }
}

async function promptContinue(): Promise<boolean> {
  const { confirm } = await import('@inquirer/prompts');
  return confirm({ message: 'Continue anyway?', default: false });
}
