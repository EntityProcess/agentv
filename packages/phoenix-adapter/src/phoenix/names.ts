import crypto from 'node:crypto';

export function stableDatasetName(sourcePath: string, namespace = 'agentv-examples'): string {
  const slug = sourcePath
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const hash = crypto.createHash('sha1').update(sourcePath).digest('hex').slice(0, 8);
  return `${namespace}-${slug}-${hash}`;
}
