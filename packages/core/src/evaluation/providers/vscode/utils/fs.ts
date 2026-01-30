import { constants } from 'node:fs';
import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export interface DirectoryEntry {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
}

export async function readDirEntries(target: string): Promise<DirectoryEntry[]> {
  const entries = await readdir(target, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    absolutePath: path.join(target, entry.name),
    isDirectory: entry.isDirectory(),
  }));
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    const result = await stat(target);
    return result.isDirectory();
  } catch {
    return false;
  }
}

export async function removeIfExists(target: string): Promise<void> {
  try {
    await rm(target, { force: true, recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
