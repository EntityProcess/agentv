import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = join(import.meta.dir, '../../..');
const ROOT_SKILLS_DIR = join(ROOT_DIR, '.claude/skills');
const ROOT_PROMPTS_DIR = join(ROOT_DIR, '.github/prompts');

const TARGET_SKILLS_DIR = join(import.meta.dir, '../src/templates/.claude/skills');
const TARGET_PROMPTS_DIR = join(import.meta.dir, '../src/templates/.github/prompts');

const SKILLS_TO_SYNC = [
  'agentv-eval-builder',
  'agentv-prompt-optimizer',
];

console.log('Syncing skills and prompts to apps/cli/src/templates...');

// 1. Sync Skills
for (const skill of SKILLS_TO_SYNC) {
  const source = join(ROOT_SKILLS_DIR, skill);
  const target = join(TARGET_SKILLS_DIR, skill);

  if (existsSync(source)) {
    console.log(`- Syncing skill: ${skill}...`);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    mkdirSync(target, { recursive: true });
    cpSync(source, target, { recursive: true });
  } else {
    console.warn(`Warning: Source skill ${skill} not found at ${source}`);
  }
}

// 2. Sync Prompts (starting with agentv-)
if (existsSync(ROOT_PROMPTS_DIR)) {
  const promptFiles = readdirSync(ROOT_PROMPTS_DIR).filter(f => f.startsWith('agentv-'));
  
  if (promptFiles.length > 0) {
    if (!existsSync(TARGET_PROMPTS_DIR)) {
      mkdirSync(TARGET_PROMPTS_DIR, { recursive: true });
    }

    for (const file of promptFiles) {
      console.log(`- Syncing prompt: ${file}...`);
      cpSync(join(ROOT_PROMPTS_DIR, file), join(TARGET_PROMPTS_DIR, file));
    }
  }
}

console.log('Done!');
