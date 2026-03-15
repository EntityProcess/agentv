#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const healthcheck = process.argv.includes('--healthcheck');
if (healthcheck) {
  console.log('offline-grader-benchmark replay target: healthy');
  process.exit(0);
}

const prompt = getArg('--prompt');
const outputPath = getArg('--output');

if (!prompt || !outputPath) {
  console.error('Usage: bun replay-fixture-output.ts --prompt <text> --output <file>');
  process.exit(1);
}

const startMarker = '<<<AGENT_OUTPUT';
const endMarker = '>>>AGENT_OUTPUT';
const start = prompt.indexOf(startMarker);
const end = prompt.indexOf(endMarker);

if (start === -1 || end === -1 || end <= start) {
  console.error('Prompt is missing <<<AGENT_OUTPUT ... >>>AGENT_OUTPUT markers');
  process.exit(1);
}

const answer = prompt.slice(start + startMarker.length, end).trim();
writeFileSync(outputPath, `${answer}\n`, 'utf-8');
