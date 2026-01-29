import path from 'node:path';

export function pathToFileUri(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const normalizedPath = absolutePath.replace(/\\/g, '/');

  if (/^[a-zA-Z]:\//.test(normalizedPath)) {
    return `file:///${normalizedPath}`;
  }

  return `file://${normalizedPath}`;
}
