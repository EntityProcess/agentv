import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_SKILLS_DIR = join(import.meta.dir, '../../../.claude/skills');
const TARGET_SKILLS_DIR = join(import.meta.dir, '../src/templates/.claude/skills');

const SKILLS_TO_SYNC = [
  'agentv-eval-builder',
  'agentv-prompt-optimizer',
];

console.log('Syncing skills from root .claude/skills to apps/cli/src/templates/.claude/skills...');

for (const skill of SKILLS_TO_SYNC) {
  const source = join(ROOT_SKILLS_DIR, skill);
  const target = join(TARGET_SKILLS_DIR, skill);

  if (existsSync(source)) {
    console.log(`- Syncing ${skill}...`);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    mkdirSync(target, { recursive: true });
    cpSync(source, target, {
      recursive: true,
      filter: (src) => {
        // Skip .DS_Store or other common noise if they exist
        const basename = src.split('/').pop();
        if (basename === '.DS_Store') return false;
        return true;
      },
    });
  } else {
    console.warn(`Warning: Source skill ${skill} not found at ${source}`);
  }
}

console.log('Done!');
