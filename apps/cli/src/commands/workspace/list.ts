import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { command } from 'cmd-ts';

import { getWorkspacePoolRoot } from '@agentv/core';

interface PoolMetadata {
  fingerprint: string;
  templatePath: string | null;
  repos: readonly { path: string; source: { type: string; url?: string; path?: string } }[];
  createdAt: string;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else {
        const stats = await stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch {
    // Directory might not be readable
  }
  return totalSize;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const listCommand = command({
  name: 'list',
  description: 'List workspace pool entries',
  args: {},
  handler: async () => {
    const poolRoot = getWorkspacePoolRoot();

    if (!existsSync(poolRoot)) {
      console.log('No workspace pool entries found.');
      return;
    }

    const entries = await readdir(poolRoot, { withFileTypes: true });
    const poolDirs = entries.filter((e) => e.isDirectory());

    if (poolDirs.length === 0) {
      console.log('No workspace pool entries found.');
      return;
    }

    for (const dir of poolDirs) {
      const poolDir = path.join(poolRoot, dir.name);
      const fingerprint = dir.name;

      // Count slots
      const poolEntries = await readdir(poolDir, { withFileTypes: true });
      const slots = poolEntries.filter(
        (e) => e.isDirectory() && e.name.startsWith('slot-'),
      );

      // Read metadata
      const metadataPath = path.join(poolDir, 'metadata.json');
      let metadata: PoolMetadata | null = null;
      try {
        const raw = await readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(raw) as PoolMetadata;
      } catch {
        // metadata.json might not exist
      }

      // Compute disk size
      const size = await getDirectorySize(poolDir);

      console.log(`  ${fingerprint.slice(0, 12)}...`);
      console.log(`    Slots: ${slots.length}`);
      console.log(`    Size:  ${formatSize(size)}`);
      if (metadata) {
        if (metadata.templatePath) {
          console.log(`    Template: ${metadata.templatePath}`);
        }
        if (metadata.repos && metadata.repos.length > 0) {
          const repoSources = metadata.repos.map((r) =>
            r.source.type === 'git' ? r.source.url : r.source.path,
          );
          console.log(`    Repos: ${repoSources.join(', ')}`);
        }
        console.log(`    Created: ${metadata.createdAt}`);
      }
      console.log();
    }
  },
});
