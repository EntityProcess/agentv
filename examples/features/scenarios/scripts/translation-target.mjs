import { readFileSync, writeFileSync } from 'node:fs';

const promptFile = process.argv[2];
const outputFile = process.argv[3];

const translations = new Map([
  ["Translate 'hello' to Portuguese.", 'ola'],
  ["Translate 'hello' to French.", 'bonjour'],
  ["Translate 'hello world' to Spanish.", 'hola mundo'],
  ["Translate 'thank you' to Spanish.", 'gracias'],
]);

const prompt = readFileSync(promptFile, 'utf8').trim();
const text = translations.get(prompt) ?? `unexpected prompt: ${prompt}`;

writeFileSync(outputFile, JSON.stringify({ text }));
