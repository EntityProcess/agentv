import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { command, flag, option, optional, string } from 'cmd-ts';

import { getAgentsTemplates, getAgentvTemplates } from '../../templates/index.js';

export interface InitCommandOptions {
  targetPath?: string;
  skipExisting?: boolean;
  replaceExisting?: boolean;
}

export type InitMode = 'prompt' | 'skip-existing' | 'replace-existing';

export interface InitActionInput {
  templatePaths: string[];
  existingPaths: Set<string>;
  mode: InitMode;
}

export interface InitActionPlan {
  needsPrompt: boolean;
  toWrite: string[];
  toSkip: string[];
}

interface TemplateInstall {
  relativePath: string;
  absolutePath: string;
  content: string;
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function resolveInitMode(options: {
  skipExisting: boolean;
  replaceExisting: boolean;
}): InitMode {
  if (options.skipExisting && options.replaceExisting) {
    throw new Error('Cannot specify both --skip-existing and --replace-existing');
  }
  if (options.skipExisting) {
    return 'skip-existing';
  }
  if (options.replaceExisting) {
    return 'replace-existing';
  }
  return 'prompt';
}

export function computeInitActions(input: InitActionInput): InitActionPlan {
  const { templatePaths, existingPaths, mode } = input;

  if (mode === 'prompt' && existingPaths.size > 0) {
    return {
      needsPrompt: true,
      toWrite: [],
      toSkip: [],
    };
  }

  if (mode === 'replace-existing' || mode === 'prompt') {
    return {
      needsPrompt: false,
      toWrite: [...templatePaths],
      toSkip: [],
    };
  }

  const toWrite = templatePaths.filter((templatePath) => !existingPaths.has(templatePath));
  const toSkip = templatePaths.filter((templatePath) => existingPaths.has(templatePath));
  return {
    needsPrompt: false,
    toWrite,
    toSkip,
  };
}

async function promptYesNo(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`${message} (y/N): `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  const targetPath = path.resolve(options.targetPath ?? '.');
  const agentvDir = normalizePath(path.relative(targetPath, path.join(targetPath, '.agentv')));
  const agentsDir = normalizePath(path.relative(targetPath, path.join(targetPath, '.agents')));
  const initMode = resolveInitMode({
    skipExisting: options.skipExisting ?? false,
    replaceExisting: options.replaceExisting ?? false,
  });

  // Get templates
  const agentvTemplates = getAgentvTemplates();
  const agentsTemplates = getAgentsTemplates();

  // Separate .env.example from other .agentv templates
  const envTemplate = agentvTemplates.find((t) => t.path === '.env.example');
  const otherAgentvTemplates = agentvTemplates.filter((t) => t.path !== '.env.example');

  const templates: TemplateInstall[] = [];

  if (envTemplate) {
    templates.push({
      relativePath: '.env.example',
      absolutePath: path.join(targetPath, '.env.example'),
      content: envTemplate.content,
    });
  }

  for (const template of otherAgentvTemplates) {
    templates.push({
      relativePath: normalizePath(path.join('.agentv', template.path)),
      absolutePath: path.join(targetPath, '.agentv', template.path),
      content: template.content,
    });
  }

  for (const template of agentsTemplates) {
    templates.push({
      relativePath: normalizePath(path.join('.agents', template.path)),
      absolutePath: path.join(targetPath, '.agents', template.path),
      content: template.content,
    });
  }

  const existingFiles = templates
    .map((template) => template.relativePath)
    .filter((relativePath) => existsSync(path.join(targetPath, relativePath)));
  const existingFilesSet = new Set(existingFiles);
  const templatePaths = templates.map((template) => template.relativePath);
  let actionPlan = computeInitActions({
    templatePaths,
    existingPaths: existingFilesSet,
    mode: initMode,
  });

  if (actionPlan.needsPrompt) {
    console.log('We detected an existing setup:');
    for (const file of existingFiles) {
      console.log(`  - ${file}`);
    }
    console.log();

    const shouldReplace = await promptYesNo('Do you want to replace these files?');
    if (!shouldReplace) {
      console.log('\nInit cancelled. No files were changed.');
      return;
    }
    console.log();

    actionPlan = computeInitActions({
      templatePaths,
      existingPaths: existingFilesSet,
      mode: 'replace-existing',
    });
  }

  const filesToWrite = new Set(actionPlan.toWrite);
  const filesToSkip = new Set(actionPlan.toSkip);
  let createdCount = 0;
  let replacedCount = 0;
  let skippedCount = 0;

  for (const template of templates) {
    if (filesToSkip.has(template.relativePath)) {
      console.log(`Skipped existing ${template.relativePath}`);
      skippedCount += 1;
      continue;
    }

    if (!filesToWrite.has(template.relativePath)) {
      continue;
    }

    const targetDirPath = path.dirname(template.absolutePath);
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    const wasExisting = existingFilesSet.has(template.relativePath);
    writeFileSync(template.absolutePath, template.content, 'utf-8');
    if (wasExisting) {
      console.log(`Replaced ${template.relativePath}`);
      replacedCount += 1;
    } else {
      console.log(`Created ${template.relativePath}`);
      createdCount += 1;
    }
  }

  if (filesToWrite.size === 0 && filesToSkip.size > 0) {
    console.log('\nAgentV initialization complete (no changes required).');
  } else {
    console.log('\nAgentV initialized successfully!');
  }
  console.log('\nSummary:');
  console.log(`  - created: ${createdCount}`);
  console.log(`  - replaced: ${replacedCount}`);
  console.log(`  - skipped: ${skippedCount}`);
  console.log(`\nFiles managed in ${agentvDir} and ${agentsDir}.`);
  console.log('\nYou can now:');
  console.log('  1. Copy .env.example to .env and add your API credentials');
  console.log('  2. Configure targets in .agentv/targets.yaml');
  console.log('  3. Create eval files using the schema and prompt templates');
}

export const initCmdTsCommand = command({
  name: 'init',
  description: 'Initialize AgentV in your project (installs config files and skills)',
  args: {
    path: option({
      type: optional(string),
      long: 'path',
      description: 'Target directory for initialization (default: current directory)',
    }),
    skipExisting: flag({
      long: 'skip-existing',
      description: 'Create only missing files and keep existing files unchanged',
    }),
    replaceExisting: flag({
      long: 'replace-existing',
      description: 'Replace existing files without prompting',
    }),
  },
  handler: async ({ path: targetPath, skipExisting, replaceExisting }) => {
    try {
      await initCommand({ targetPath, skipExisting, replaceExisting });
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
