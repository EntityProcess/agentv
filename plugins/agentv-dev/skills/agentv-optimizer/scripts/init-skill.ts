#!/usr/bin/env bun
import { initSkill } from '../src/skill-initializer.js';

function printUsage() {
  console.log('Usage: bun scripts/init-skill.ts <skill-name> --path <path> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --path <path>              Directory where skill will be created (required)');
  console.log('  --resources <list>         Comma-separated: scripts,references,assets');
  console.log('  --examples                 Include example files (default: true)');
  console.log('  --no-examples              Omit example files');
  console.log('  --interface <key=value>    Interface override (repeatable)');
  console.log('');
  console.log('Examples:');
  console.log('  bun scripts/init-skill.ts my-new-skill --path skills/public');
  console.log(
    '  bun scripts/init-skill.ts my-api-helper --path skills/private --resources scripts,references',
  );
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const skillName = args[0];

  const pathIdx = args.indexOf('--path');
  if (pathIdx === -1 || !args[pathIdx + 1]) {
    console.error('Error: --path is required');
    printUsage();
    process.exit(1);
  }
  const path = args[pathIdx + 1];

  // Parse --resources
  let resources: Array<'scripts' | 'references' | 'assets'> | undefined;
  const resourcesIdx = args.indexOf('--resources');
  if (resourcesIdx !== -1 && args[resourcesIdx + 1]) {
    const valid = new Set(['scripts', 'references', 'assets']);
    resources = args[resourcesIdx + 1].split(',').map((r) => r.trim()) as Array<
      'scripts' | 'references' | 'assets'
    >;
    for (const r of resources) {
      if (!valid.has(r)) {
        console.error(`Error: Invalid resource type '${r}'. Valid: scripts, references, assets`);
        process.exit(1);
      }
    }
  }

  // Parse --examples / --no-examples
  const examples = !args.includes('--no-examples');

  // Parse --interface (repeatable)
  const interfaceOverrides: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interface' && args[i + 1]) {
      interfaceOverrides.push(args[i + 1]);
      i++;
    }
  }

  console.log(`🚀 Initializing skill: ${skillName}`);
  console.log(`   Location: ${path}`);
  console.log('');

  const result = initSkill(skillName, path, {
    resources,
    examples,
    interfaceOverrides: interfaceOverrides.length > 0 ? interfaceOverrides : undefined,
  });

  process.exit(result ? 0 : 1);
}

main();
