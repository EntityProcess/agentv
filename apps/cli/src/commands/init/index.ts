import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";

import {
  getAgentvTemplates,
  getClaudeTemplates,
  getGithubTemplates,
} from "../../templates/index.js";

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
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  const targetPath = path.resolve(options.targetPath ?? ".");
  const githubDir = path.join(targetPath, ".github");
  const agentvDir = path.join(targetPath, ".agentv");
  const claudeDir = path.join(targetPath, ".claude");

  // Get templates
  const githubTemplates = getGithubTemplates();
  const agentvTemplates = getAgentvTemplates();
  const claudeTemplates = getClaudeTemplates();

  // Separate .env.template from other .agentv templates
  const envTemplate = agentvTemplates.find((t) => t.path === ".env.template");
  const otherAgentvTemplates = agentvTemplates.filter((t) => t.path !== ".env.template");

  // Check if any files already exist
  const existingFiles: string[] = [];

  // Check for .env.template in root
  if (envTemplate) {
    const envFilePath = path.join(targetPath, ".env.template");
    if (existsSync(envFilePath)) {
      existingFiles.push(".env.template");
    }
  }

  if (existsSync(githubDir)) {
    for (const template of githubTemplates) {
      const targetFilePath = path.join(githubDir, template.path);
      if (existsSync(targetFilePath)) {
        existingFiles.push(path.relative(targetPath, targetFilePath));
      }
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
  if (existsSync(claudeDir)) {
    for (const template of claudeTemplates) {
      const targetFilePath = path.join(claudeDir, template.path);
      if (existsSync(targetFilePath)) {
        existingFiles.push(path.relative(targetPath, targetFilePath));
      }
    }
  }

  // If files exist, prompt user
  if (existingFiles.length > 0) {
    console.log("We detected an existing setup:");
    for (const file of existingFiles) {
      console.log(`  - ${file}`);
    }
    console.log();

    const shouldReplace = await promptYesNo("Do you want to replace these files?");
    if (!shouldReplace) {
      console.log("\nInit cancelled. No files were changed.");
      return;
    }
    console.log();
  }

  // Create .github directory if it doesn't exist
  if (!existsSync(githubDir)) {
    mkdirSync(githubDir, { recursive: true });
  }

  // Create .agentv directory if it doesn't exist
  if (!existsSync(agentvDir)) {
    mkdirSync(agentvDir, { recursive: true });
  }

  // Create .claude directory if it doesn't exist
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Create .env.template in the current working directory
  if (envTemplate) {
    const envFilePath = path.join(targetPath, ".env.template");
    writeFileSync(envFilePath, envTemplate.content, "utf-8");
    console.log("Created .env.template");
  }

  // Copy each .github template
  for (const template of githubTemplates) {
    const targetFilePath = path.join(githubDir, template.path);
    const targetDirPath = path.dirname(targetFilePath);

    // Create directory if needed
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(targetFilePath, template.content, "utf-8");
    console.log(`Created ${path.relative(targetPath, targetFilePath)}`);
  }

  // Copy remaining .agentv templates (excluding .env.template)
  for (const template of otherAgentvTemplates) {
    const targetFilePath = path.join(agentvDir, template.path);
    const targetDirPath = path.dirname(targetFilePath);

    // Create directory if needed
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(targetFilePath, template.content, "utf-8");
    console.log(`Created ${path.relative(targetPath, targetFilePath)}`);
  }

  // Copy each .claude template
  for (const template of claudeTemplates) {
    const targetFilePath = path.join(claudeDir, template.path);
    const targetDirPath = path.dirname(targetFilePath);

    // Create directory if needed
    if (!existsSync(targetDirPath)) {
      mkdirSync(targetDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(targetFilePath, template.content, "utf-8");
    console.log(`Created ${path.relative(targetPath, targetFilePath)}`);
  }

  console.log("\nAgentV initialized successfully!");
  console.log("\nFiles installed to root:");
  if (envTemplate) {
    console.log("  - .env.template");
  }
  console.log(`\nFiles installed to ${path.relative(targetPath, githubDir)}:`);
  for (const t of githubTemplates) {
    console.log(`  - ${t.path}`);
  }
  console.log(`\nFiles installed to ${path.relative(targetPath, agentvDir)}:`);
  for (const t of otherAgentvTemplates) {
    console.log(`  - ${t.path}`);
  }
  console.log(`\nFiles installed to ${path.relative(targetPath, claudeDir)}:`);
  for (const t of claudeTemplates) {
    console.log(`  - ${t.path}`);
  }
  console.log("\nYou can now:");
  console.log("  1. Copy .env.template to .env and add your API credentials");
  console.log("  2. Configure targets in .agentv/targets.yaml");
  console.log("  3. Create eval files using the schema and prompt templates");
}
