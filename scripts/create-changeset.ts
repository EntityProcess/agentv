#!/usr/bin/env tsx
/**
 * Non-interactive changeset creator
 *
 * Creates a changeset file without requiring interactive prompts.
 * Works well for automated workflows and CI/CD pipelines.
 *
 * Usage:
 *   Direct arguments:
 *   bun run create-changeset "@agentv/core:minor,agentv:patch" "Description of changes"
 *
 *   From JSON stdin:
 *   echo '{"packages":{"@agentv/core":"minor","agentv":"patch"},"description":"fix: bug"}' | bun run create-changeset
 *
 *   Interactive (no args):
 *   bun run create-changeset
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHANGESET_DIR = resolve(process.cwd(), '.changeset');
const VALID_SEMVER = ['patch', 'minor', 'major'] as const;
const VALID_PACKAGES = ['@agentv/core', '@agentv/eval', 'agentv'];

/**
 * Generate a unique changeset filename
 * Uses adjective-noun-hash format similar to changelog style
 */
function generateChangesetName(): string {
  const adjectives = ['quick', 'happy', 'smart', 'fresh', 'eager', 'clean', 'brave', 'great'];
  const nouns = ['fix', 'change', 'update', 'add', 'improve', 'boost', 'refactor', 'enhance'];

  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const hash = randomBytes(2).toString('hex');

  return `${adjective}-${noun}-${hash}`;
}

interface ChangesetInput {
  packages: Record<string, (typeof VALID_SEMVER)[number]>;
  description: string;
}

/**
 * Parse command-line argument format: "pkg1:type1,pkg2:type2"
 */
function parsePackageArg(arg: string): Record<string, (typeof VALID_SEMVER)[number]> {
  const packages: Record<string, (typeof VALID_SEMVER)[number]> = {};

  for (const pair of arg.split(',')) {
    const [pkg, type] = pair.trim().split(':');

    if (!pkg || !type) {
      throw new Error(
        `Invalid package format: "${pair}". Use "pkg:type" (e.g., "@agentv/core:minor")`,
      );
    }

    if (!VALID_PACKAGES.includes(pkg)) {
      throw new Error(`Unknown package: "${pkg}". Valid packages: ${VALID_PACKAGES.join(', ')}`);
    }

    const semverType = type.toLowerCase() as (typeof VALID_SEMVER)[number];
    if (!VALID_SEMVER.includes(semverType)) {
      throw new Error(`Invalid semver type: "${type}". Must be one of: ${VALID_SEMVER.join(', ')}`);
    }

    packages[pkg] = semverType;
  }

  if (Object.keys(packages).length === 0) {
    throw new Error('No packages specified');
  }

  return packages;
}

/**
 * Read input from stdin (for piped JSON)
 */
async function readStdin(): Promise<string> {
  let data = '';

  return new Promise((resolve, reject) => {
    process.stdin.setEncoding('utf-8');

    process.stdin.on('readable', () => {
      let chunk: string | null = process.stdin.read();
      while (chunk !== null) {
        data += chunk;
        chunk = process.stdin.read();
      }
    });

    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);

    // Set timeout to detect if stdin is not being piped
    setTimeout(() => {
      if (!data) {
        resolve(''); // Return empty string if nothing is piped
      }
    }, 100);
  });
}

/**
 * Interactive mode using console prompts
 */
async function promptInteractive(): Promise<ChangesetInput> {
  const prompt = (question: string, defaultVal?: string): Promise<string> => {
    return new Promise((resolve) => {
      process.stdout.write(question + (defaultVal ? ` [${defaultVal}]: ` : ': '));
      process.stdin.once('data', (data) => {
        const answer = data.toString().trim() || defaultVal || '';
        resolve(answer);
      });
    });
  };

  console.log('\n📝 Create a new changeset\n');

  // Get packages
  console.log('Available packages:');
  VALID_PACKAGES.forEach((pkg, i) => console.log(`  ${i + 1}. ${pkg}`));

  const packageStr = await prompt(
    '\nPackages to include (format: "pkg1:type1,pkg2:type2" or "1:minor,2:patch")',
  );

  let packages: Record<string, (typeof VALID_SEMVER)[number]>;

  // Handle numeric shortcuts
  if (/^\d/.test(packageStr)) {
    packages = {};
    for (const pair of packageStr.split(',')) {
      const [idx, type] = pair.trim().split(':');
      const pkgIndex = Number.parseInt(idx) - 1;

      if (pkgIndex < 0 || pkgIndex >= VALID_PACKAGES.length) {
        throw new Error(`Invalid package index: ${idx}`);
      }

      packages[VALID_PACKAGES[pkgIndex]] = type.toLowerCase() as (typeof VALID_SEMVER)[number];
    }
  } else {
    packages = parsePackageArg(packageStr);
  }

  // Get description
  const description = await prompt('\nDescription of changes');

  if (!description) {
    throw new Error('Description is required');
  }

  return { packages, description };
}

/**
 * Create and write the changeset file
 */
function createChangeset(input: ChangesetInput): void {
  const filename = generateChangesetName();
  const filepath = resolve(CHANGESET_DIR, `${filename}.md`);

  // Build YAML frontmatter
  const frontmatter = Object.entries(input.packages)
    .map(([pkg, type]) => `"${pkg}": ${type}`)
    .join('\n');

  const content = `---\n${frontmatter}\n---\n\n${input.description}\n`;

  writeFileSync(filepath, content, 'utf-8');

  console.log(`\n✅ Changeset created: .changeset/${filename}.md\n`);
  console.log('Changes:');
  for (const [pkg, type] of Object.entries(input.packages)) {
    console.log(`  ${pkg}: ${type}`);
  }
  console.log(`\nDescription: ${input.description}\n`);
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
📝 Non-Interactive Changeset Creator

Create changeset files without interactive prompts. Perfect for CI/CD pipelines.

USAGE:
  bun run changeset:create [OPTIONS] [PACKAGES] [DESCRIPTION]

OPTIONS:
  --help, -h              Show this help message

MODES:

  1. Command-line arguments (fully automated):
     bun run changeset:create "@agentv/core:patch" "fix: resolve issue"
     bun run changeset:create "@agentv/core:minor,agentv:patch" "feat: new feature"

  2. JSON via stdin (best for CI/CD):
     echo '{"packages":{"@agentv/core":"minor"},"description":"feat: new feature"}' | bun run changeset:create

  3. Interactive mode (no arguments):
     bun run changeset:create

VALID PACKAGES:
  @agentv/core    Core evaluation engine
  @agentv/eval    Evaluation package
  agentv          CLI package

SEMVER TYPES:
  patch           Bug fixes and small improvements
  minor           New features (backwards compatible)
  major           Breaking changes

EXAMPLES:
  # Patch fix for core
  bun run changeset:create "@agentv/core:patch" "fix: memory leak in evaluator"

  # Multiple packages
  bun run changeset:create "@agentv/core:minor,agentv:patch" "feat: add filter support"

  # From CI/CD with JSON
  echo '{"packages":{"agentv":"major"},"description":"refactor: restructure CLI"}' | bun run changeset:create

WORKFLOW:
  1. Create changesets: bun run changeset:create "pkg:type" "description"
  2. Release version:   bun run version
  3. Commit and push:   git add . && git commit && git push
`);
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Check for help flag
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      printHelp();
      process.exit(0);
    }

    let input: ChangesetInput | null = null;

    // Try reading from stdin first (for piped input)
    const stdinData = await readStdin();

    if (stdinData.trim()) {
      try {
        const parsed = JSON.parse(stdinData);
        input = {
          packages: parsed.packages,
          description: parsed.description,
        };
      } catch (e) {
        throw new Error(`Invalid JSON from stdin: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (process.argv.length >= 4) {
      // Command-line arguments provided
      const packageStr = process.argv[2];
      const description = process.argv[3];

      input = {
        packages: parsePackageArg(packageStr),
        description,
      };
    } else {
      // Interactive mode
      input = await promptInteractive();
    }

    if (!input) {
      throw new Error('No input provided');
    }

    createChangeset(input);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.error('\nUsage:');
    console.error('  bun run create-changeset "pkg1:type1,pkg2:type2" "Description"');
    console.error(
      '  echo \'{"packages":{"@agentv/core":"minor"},"description":"..."}\' | bun run create-changeset',
    );
    process.exit(1);
  }
}

main();
