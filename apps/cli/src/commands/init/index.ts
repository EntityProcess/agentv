import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { command, option, optional, string } from 'cmd-ts';

import { getAgentsTemplates, getAgentvTemplates } from '../../templates/index.js';

export interface InitCommandOptions {
  targetPath?: string;
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
  const agentvDir = path.join(targetPath, '.agentv');
  const agentsDir = path.join(targetPath, '.agents');

  // Get templates
  const agentvTemplates = getAgentvTemplates();
  const agentsTemplates = getAgentsTemplates();

  // Separate .env.example from other .agentv templates
  const envTemplate = agentvTemplates.find((t) => t.path === '.env.example');
  const otherAgentvTemplates = agentvTemplates.filter((t) => t.path !== '.env.example');

  // Check if any files already exist
  const existingFiles: string[] = [];

  // Check for .env.example in root
  if (envTemplate) {
    const envFilePath = path.join(targetPath, '.env.example');
    if (existsSync(envFilePath)) {
      existingFiles.push('.env.example');
    }
  }

  if (existsSync(agentvDir)) {
    for (const template of otherAgentvTemplates) {
      const targetFilePath = path.join(agentvDir, template.path);
      if (existsSync(targetFilePath)) {
        existingFiles.push(path.relative(targetPath, targetFilePath));
      }
    }
  }
  if (existsSync(agentsDir)) {
    for (const template of agentsTemplates) {
      const targetFilePath = path.join(agentsDir, template.path);
      if (existsSync(targetFilePath)) {
        existingFiles.push(path.relative(targetPath, targetFilePath));
      }
    }
  }

  // If files exist, prompt user
  if (existingFiles.length > 0) {
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
  }

  // Create .agentv directory if it doesn't exist
  if (!existsSync(agentvDir)) {
    mkdirSync(agentvDir, { recursive: true });
  }

  // Create .agents directory if it doesn't exist
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }

  // Create .env.example in the current working directory
  if (envTemplate) {
    const envFilePath = path.join(targetPath, '.env.example');
    writeFileSync(envFilePath, envTemplate.content, 'utf-8');
    console.log('Created .env.example');
  }

  // Copy remaining .agentv templates (excluding .env.example)
  for (const template of otherAgentvTemplates) {
    const targetFilePath = path.join(agentvDir, template.path);
    const targetDirPath = path.dirname(targetFilePath);

    // Create directory if needed
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(targetFilePath, template.content, 'utf-8');
    console.log(`Created ${path.relative(targetPath, targetFilePath)}`);
  }

  // Copy each .agents template
  for (const template of agentsTemplates) {
    const targetFilePath = path.join(agentsDir, template.path);
    const targetDirPath = path.dirname(targetFilePath);

    // Create directory if needed
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(targetFilePath, template.content, 'utf-8');
    console.log(`Created ${path.relative(targetPath, targetFilePath)}`);
  }

  console.log('\nAgentV initialized successfully!');
  console.log('\nFiles installed to root:');
  if (envTemplate) {
    console.log('  - .env.example');
  }
  console.log(`\nFiles installed to ${path.relative(targetPath, agentvDir)}:`);
  for (const t of otherAgentvTemplates) {
    console.log(`  - ${t.path}`);
  }
  console.log(`\nFiles installed to ${path.relative(targetPath, agentsDir)}:`);
  for (const t of agentsTemplates) {
    console.log(`  - ${t.path}`);
  }
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
  },
  handler: async ({ path: targetPath }) => {
    try {
      await initCommand({ targetPath });
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  },
});
