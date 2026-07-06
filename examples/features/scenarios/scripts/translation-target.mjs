import { readFileSync, writeFileSync } from 'node:fs';

const promptFile = process.argv[2];
const outputFile = process.argv[3];

const translations = new Map([
  ["Translate 'hello' to Spanish.", 'hola'],
  ["Translate 'thank you' to Spanish.", 'gracias'],
  ["Translate 'hello' to French.", 'bonjour'],
  ["Translate 'thank you' to French.", 'merci'],
  ["Translate 'hello' to Portuguese.", 'ola'],
  ["Translate 'thank you' to Portuguese.", 'obrigado'],
]);

const prompt = readFileSync(promptFile, 'utf8').trim();
const text = translations.get(prompt) ?? `unexpected prompt: ${prompt}`;

writeFileSync(outputFile, JSON.stringify({ text }));
