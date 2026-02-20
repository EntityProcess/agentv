import path from 'node:path';
import { listTargetNames, readTargetDefinitions } from '@agentv/core';
import { checkbox, confirm, number, search, select } from '@inquirer/prompts';

import { TARGET_FILE_CANDIDATES, fileExists } from '../../utils/targets.js';
import {
  type DiscoveredEvalFile,
  discoverEvalFiles,
  filterByCategory,
  getCategories,
} from './discover.js';
import { type LastConfig, loadLastConfig, saveLastConfig } from './last-config.js';
import { runEvalCommand } from './run-eval.js';
import { findRepoRoot } from './shared.js';

const ANSI_BOLD = '\x1b[1m';
const ANSI_DIM = '\x1b[2m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_RESET = '\x1b[0m';

export interface InteractiveConfig {
  readonly evalPaths: readonly string[];
  readonly target: string;
  readonly workers: number;
  readonly dryRun: boolean;
  readonly cache: boolean;
}

/**
 * Launch the interactive wizard when `agentv eval` is called with no arguments.
 */
export async function launchInteractiveWizard(): Promise<void> {
  const cwd = process.cwd();

  console.log(`\n${ANSI_BOLD}${ANSI_CYAN}AgentV Interactive Mode${ANSI_RESET}\n`);

  const lastConfig = await loadLastConfig();
  const action = await promptMainMenu(lastConfig);

  if (action === 'exit') {
    return;
  }

  if (action === 'rerun' && lastConfig) {
    console.log(`\n${ANSI_DIM}Rerunning last configuration...${ANSI_RESET}\n`);
    await executeConfig({
      evalPaths: lastConfig.evalPaths,
      target: lastConfig.target,
      workers: lastConfig.workers,
      dryRun: lastConfig.dryRun,
      cache: lastConfig.cache,
    });
    return;
  }

  // Run new evaluation flow
  const config = await promptNewEvaluation(cwd);
  if (!config) {
    return;
  }

  // Review & confirm
  const confirmed = await promptReviewAndConfirm(config, cwd);
  if (!confirmed) {
    return;
  }

  // Save last config
  await saveLastConfig({
    timestamp: new Date().toISOString(),
    cwd,
    evalPaths: config.evalPaths,
    target: config.target,
    workers: config.workers,
    dryRun: config.dryRun,
    cache: config.cache,
  });

  await executeConfig(config);
}

async function promptMainMenu(
  lastConfig: LastConfig | undefined,
): Promise<'new' | 'rerun' | 'exit'> {
  type MenuChoice = 'new' | 'rerun' | 'exit';
  const choices: Array<{ name: string; value: MenuChoice; description?: string }> = [];

  if (lastConfig) {
    const evalCount = lastConfig.evalPaths.length;
    choices.push({
      name: '🔄 Rerun last config',
      value: 'rerun',
      description: `${evalCount} eval file(s), target: ${lastConfig.target}`,
    });
  }

  choices.push({ name: '🚀 Run new evaluation', value: 'new' }, { name: '✕ Exit', value: 'exit' });

  return select<MenuChoice>({
    message: 'What would you like to do?',
    choices,
  });
}

async function promptNewEvaluation(cwd: string): Promise<InteractiveConfig | undefined> {
  // Step 1: Discover eval files
  console.log(`\n${ANSI_DIM}Scanning for eval files...${ANSI_RESET}`);
  const allFiles = await discoverEvalFiles(cwd);

  if (allFiles.length === 0) {
    console.log(
      '\n⚠  No eval files found in the current directory.\n' +
        '   Place .yaml or .jsonl eval files in your project, or use:\n' +
        '   agentv eval <path-to-eval.yaml>\n',
    );
    return undefined;
  }

  console.log(`${ANSI_DIM}Found ${allFiles.length} eval file(s)${ANSI_RESET}\n`);

  // Step 2: Select eval files (optionally filter by category first)
  const selectedFiles = await promptEvalSelection(allFiles);
  if (selectedFiles.length === 0) {
    console.log('\nNo eval files selected.');
    return undefined;
  }

  // Step 3: Select target
  const target = await promptTargetSelection(cwd, selectedFiles[0].path);

  // Step 4: Advanced options
  const advanced = await promptAdvancedOptions();

  return {
    evalPaths: selectedFiles.map((f) => f.path),
    target,
    ...advanced,
  };
}

async function promptEvalSelection(
  allFiles: readonly DiscoveredEvalFile[],
): Promise<DiscoveredEvalFile[]> {
  const categories = getCategories(allFiles);

  // If only one category or few files, skip category selection
  let filesToSelect: readonly DiscoveredEvalFile[];

  if (categories.length > 1) {
    const selectedCategory = await search<string>({
      message: 'Select a category (type to search)',
      source: async (term) => {
        const filtered = term
          ? categories.filter((c) => c.toLowerCase().includes(term.toLowerCase()))
          : categories;
        return [
          { name: '(all categories)', value: '__all__' },
          ...filtered.map((c) => {
            const count = filterByCategory(allFiles, c).length;
            return { name: `${c} (${count} file${count > 1 ? 's' : ''})`, value: c };
          }),
        ];
      },
    });

    filesToSelect =
      selectedCategory === '__all__' ? allFiles : filterByCategory(allFiles, selectedCategory);
  } else {
    filesToSelect = allFiles;
  }

  return checkbox<DiscoveredEvalFile>({
    message: 'Select eval files to run (space to toggle, enter to confirm)',
    choices: filesToSelect.map((f) => ({
      name: f.relativePath,
      value: f,
      checked: filesToSelect.length <= 5, // auto-select if few files
    })),
    required: true,
  });
}

async function promptTargetSelection(cwd: string, firstEvalPath: string): Promise<string> {
  const repoRoot = await findRepoRoot(cwd);

  // Try to find targets.yaml — search near the eval file first, then cwd/repoRoot
  const targetsPath = await findTargetsFile(cwd, repoRoot, firstEvalPath);

  if (!targetsPath) {
    console.log(`${ANSI_DIM}No targets.yaml found. Using default target.${ANSI_RESET}`);
    return 'default';
  }

  const definitions = await readTargetDefinitions(targetsPath);
  const targetNames = listTargetNames(definitions);

  if (targetNames.length === 0) {
    return 'default';
  }

  if (targetNames.length === 1) {
    console.log(`${ANSI_DIM}Using target: ${targetNames[0]}${ANSI_RESET}`);
    return targetNames[0];
  }

  return search<string>({
    message: 'Select a target (type to search)',
    source: async (term) => {
      const filtered = term
        ? targetNames.filter((t) => t.toLowerCase().includes(term.toLowerCase()))
        : targetNames;
      return filtered.map((t) => {
        const def = definitions.find((d) => d.name === t);
        return {
          name: t,
          value: t,
          description: def ? `provider: ${def.provider}` : undefined,
        };
      });
    },
  });
}

async function findTargetsFile(
  cwd: string,
  repoRoot: string,
  evalFilePath?: string,
): Promise<string | undefined> {
  // Build directory chain: eval file dir → cwd → repoRoot (mirrors discoverTargetsFile)
  const dirsToSearch: string[] = [];

  if (evalFilePath) {
    const evalDir = path.dirname(evalFilePath);
    if (!dirsToSearch.includes(evalDir)) {
      dirsToSearch.push(evalDir);
    }
  }

  if (!dirsToSearch.includes(cwd)) {
    dirsToSearch.push(cwd);
  }

  if (repoRoot !== cwd && !dirsToSearch.includes(repoRoot)) {
    dirsToSearch.push(repoRoot);
  }

  for (const dir of dirsToSearch) {
    for (const candidate of TARGET_FILE_CANDIDATES) {
      const fullPath = `${dir}/${candidate}`;
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

async function promptAdvancedOptions(): Promise<{
  workers: number;
  dryRun: boolean;
  cache: boolean;
}> {
  const customize = await confirm({
    message: 'Configure advanced options?',
    default: false,
  });

  if (!customize) {
    return { workers: 3, dryRun: false, cache: false };
  }

  const workers =
    (await number({
      message: 'Number of parallel workers (1-50)',
      default: 3,
      min: 1,
      max: 50,
    })) ?? 3;

  const dryRun = await confirm({
    message: 'Enable dry-run mode (mock responses)?',
    default: false,
  });

  const cache = await confirm({
    message: 'Enable response cache?',
    default: false,
  });

  return { workers, dryRun, cache };
}

async function promptReviewAndConfirm(config: InteractiveConfig, cwd: string): Promise<boolean> {
  const evalDisplay = config.evalPaths
    .map((p) => {
      const rel = p.startsWith(cwd) ? p.slice(cwd.length + 1) : p;
      return `  ${rel}`;
    })
    .join('\n');

  console.log(`\n${ANSI_BOLD}Review Configuration${ANSI_RESET}`);
  console.log(`${ANSI_DIM}${'─'.repeat(40)}${ANSI_RESET}`);
  console.log(`${ANSI_GREEN}Eval files:${ANSI_RESET}\n${evalDisplay}`);
  console.log(`${ANSI_GREEN}Target:${ANSI_RESET}    ${config.target}`);
  console.log(`${ANSI_GREEN}Workers:${ANSI_RESET}   ${config.workers}`);
  console.log(`${ANSI_GREEN}Dry run:${ANSI_RESET}   ${config.dryRun ? 'yes' : 'no'}`);
  console.log(`${ANSI_GREEN}Cache:${ANSI_RESET}     ${config.cache ? 'yes' : 'no'}`);
  console.log(`${ANSI_DIM}${'─'.repeat(40)}${ANSI_RESET}`);

  return confirm({
    message: 'Run evaluation with this configuration?',
    default: true,
  });
}

async function executeConfig(config: InteractiveConfig): Promise<void> {
  const rawOptions: Record<string, unknown> = {
    target: config.target,
    workers: config.workers,
    dryRun: config.dryRun,
    cache: config.cache,
    outputFormat: 'jsonl',
    dryRunDelay: 0,
    dryRunDelayMin: 0,
    dryRunDelayMax: 0,
    agentTimeout: 120,
    maxRetries: 2,
    verbose: false,
    keepWorkspaces: false,
    cleanupWorkspaces: false,
    trace: false,
  };

  await runEvalCommand({
    testFiles: [...config.evalPaths],
    rawOptions,
  });
}
