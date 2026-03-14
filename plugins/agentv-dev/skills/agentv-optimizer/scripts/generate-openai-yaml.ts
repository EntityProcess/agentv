#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeOpenAIYaml } from '../src/skill-initializer.js';

function readFrontmatterName(skillDir: string): string | null {
  const skillMd = resolve(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) return null;

  const content = readFileSync(skillMd, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const nameMatch = match[1].match(/^name:\s*(.+)/m);
  if (!nameMatch) return null;

  return nameMatch[1].trim().replace(/^["']|["']$/g, '');
}

function printUsage() {
  console.log('Usage: bun scripts/generate-openai-yaml.ts <skill-dir> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --name <name>              Skill name (defaults to name from SKILL.md)');
  console.log('  --interface <key=value>    Interface override (repeatable)');
  console.log('');
  console.log('Examples:');
  console.log('  bun scripts/generate-openai-yaml.ts ./skills/my-skill');
  console.log('  bun scripts/generate-openai-yaml.ts ./skills/my-skill --name custom-name');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const skillDir = resolve(args[0]);

  // Parse --name
  let skillName: string | null = null;
  const nameIdx = args.indexOf('--name');
  if (nameIdx !== -1 && args[nameIdx + 1]) {
    skillName = args[nameIdx + 1];
  }

  // If no --name, read from SKILL.md
  if (!skillName) {
    skillName = readFrontmatterName(skillDir);
    if (!skillName) {
      console.error(`Error: Could not determine skill name. Provide --name or ensure SKILL.md has a 'name' field.`);
      process.exit(1);
    }
  }

  // Parse --interface (repeatable)
  const interfaceOverrides: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interface' && args[i + 1]) {
      interfaceOverrides.push(args[i + 1]);
      i++;
    }
  }

  const result = writeOpenAIYaml(skillDir, skillName, {
    interfaceOverrides: interfaceOverrides.length > 0 ? interfaceOverrides : undefined,
  });

  if (result) {
    console.log(`✅ Generated agents/openai.yaml at ${result}`);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
