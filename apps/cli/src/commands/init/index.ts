import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";

import { TemplateManager } from "../../templates/index.js";

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

  // Get templates
  const templates = TemplateManager.getTemplates();

  // Check if any files already exist
  const existingFiles: string[] = [];
  if (existsSync(githubDir)) {
    for (const template of templates) {
      const targetFilePath = path.join(githubDir, template.path);
      if (existsSync(targetFilePath)) {
        existingFiles.push(path.relative(targetPath, targetFilePath));
      }
    }
  }

  // If files exist, prompt user
  if (existingFiles.length > 0) {
    console.log("We detected an existing setup:");
    existingFiles.forEach((file) => console.log(`  - ${file}`));
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

  // Copy each template to .github
  for (const template of templates) {
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

  console.log("\nAgentV initialized successfully!");
  console.log(`\nFiles installed to ${path.relative(targetPath, githubDir)}:`);
  templates.forEach((t) => console.log(`  - ${t.path}`));
  console.log("\nYou can now create eval files using the schema and prompt templates.");
}
