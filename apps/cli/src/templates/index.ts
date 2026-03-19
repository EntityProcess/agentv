import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Template {
  path: string;
  content: string;
}

export function getAgentvTemplates(): Template[] {
  return getTemplatesFromDir('.agentv');
}

export function getEnvExampleTemplate(): Template {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const templatesBase = currentDir.includes(`${path.sep}dist`)
    ? path.join(currentDir, 'templates')
    : currentDir;
  const content = readFileSync(path.join(templatesBase, '.env.example'), 'utf-8');
  return { path: '.env.example', content };
}

function getTemplatesFromDir(subdir: string): Template[] {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  // Check if we're running from dist or src
  let templatesDir: string;
  if (currentDir.includes(`${path.sep}dist`)) {
    // Production: templates are at dist/templates/
    templatesDir = path.join(currentDir, 'templates', subdir);
  } else {
    // Development: templates are at src/templates/ (same directory as this file)
    templatesDir = path.join(currentDir, subdir);
  }

  return readTemplatesRecursively(templatesDir, '');
}

function readTemplatesRecursively(dir: string, relativePath: string): Template[] {
  const templates: Template[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    const entryRelativePath = relativePath ? path.join(relativePath, entry) : entry;

    if (stat.isDirectory()) {
      // Recursively read subdirectories
      templates.push(...readTemplatesRecursively(fullPath, entryRelativePath));
    } else {
      // Read file content
      const content = readFileSync(fullPath, 'utf-8');
      templates.push({
        path: entryRelativePath.split(path.sep).join('/'), // Normalize to forward slashes
        content,
      });
    }
  }

  return templates;
}
