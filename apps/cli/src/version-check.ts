import { coerce, major, satisfies, validRange } from 'semver';

import packageJson from '../package.json' with { type: 'json' };
import { performSelfUpdate } from './self-update.js';

const ANSI_YELLOW = '\u001b[33m';
const ANSI_RED = '\u001b[31m';
const ANSI_GREEN = '\u001b[32m';
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
    satisfied: satisfies(coerce(currentVersion) ?? currentVersion, requiredVersion),
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
 *   - Interactive (TTY): warns and prompts "Update now? (Y/n)".
 *     Y → runs self-update inline (constrained to the config range),
 *         then exits with a message to re-run the command.
 *     N → continues the command as-is.
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

  const warning = `${ANSI_YELLOW}Warning: This project requires agentv ${result.requiredRange} but you have ${result.currentVersion}.${ANSI_RESET}`;

  if (options?.strict) {
    console.error(warning);
    console.error(
      `${ANSI_RED}Aborting: --strict mode requires the installed version to satisfy the required range.${ANSI_RESET}`,
    );
    process.exit(1);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    console.warn(warning);
    const shouldUpdate = await promptUpdate();
    if (shouldUpdate) {
      await runInlineUpdate(result.currentVersion, result.requiredRange);
    }
    // N → continue the command without interruption
  } else {
    // Non-interactive: warn to stderr and continue
    process.stderr.write(`${warning}\n  Run \`agentv self update\` to upgrade.\n`);
  }
}

async function promptUpdate(): Promise<boolean> {
  const { confirm } = await import('@inquirer/prompts');
  return confirm({ message: 'Update now?', default: true });
}

async function runInlineUpdate(currentVersion: string, versionRange: string): Promise<void> {
  // Cap at the current major version to avoid unintended breaking changes.
  // e.g., if current is 4.14.2 and range is ">=4.1.0", install ">=4.1.0 <5.0.0"
  // so that a hypothetical 5.0.0 is never pulled in by auto-update.
  const currentMajor = major(coerce(currentVersion) ?? currentVersion);
  const safeRange = `${versionRange} <${currentMajor + 1}.0.0`;

  console.log('');
  const result = await performSelfUpdate({ currentVersion, versionRange: safeRange });

  if (!result.success) {
    console.error(`${ANSI_RED}Update failed. Run \`agentv self update\` manually.${ANSI_RESET}`);
    process.exit(1);
  }

  if (result.newVersion) {
    console.log(
      `\n${ANSI_GREEN}Update complete: ${currentVersion} → ${result.newVersion}${ANSI_RESET}`,
    );
  } else {
    console.log(`\n${ANSI_GREEN}Update complete.${ANSI_RESET}`);
  }
  console.log('Please re-run your command.');
  process.exit(0);
}
