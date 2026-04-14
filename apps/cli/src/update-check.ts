import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAgentvConfigDir } from '@agentv/core';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const AGENTV_DIR = getAgentvConfigDir();
const CACHE_FILE = 'version-check.json';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/agentv/latest';

export interface UpdateCache {
  latestVersion: string;
  lastCheckedAt: string; // ISO 8601
}

/**
 * Read the cached update info from disk. Returns null if missing or malformed.
 */
export async function getCachedUpdateInfo(path?: string): Promise<UpdateCache | null> {
  const filePath = path ?? join(AGENTV_DIR, CACHE_FILE);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data.latestVersion === 'string' && typeof data.lastCheckedAt === 'string') {
      return data as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a fresh check is needed based on the cache.
 */
export function shouldCheck(cache: UpdateCache | null): boolean {
  if (!cache) return true;
  const elapsed = Date.now() - new Date(cache.lastCheckedAt).getTime();
  return elapsed > CHECK_INTERVAL_MS;
}

/**
 * Compare two semver strings. Returns true if a > b.
 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((s) => Number(s.replace(/-.*$/, '')));
  const pb = b.split('.').map((s) => Number(s.replace(/-.*$/, '')));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Build a human-readable update notice, or null if no update available.
 */
export function buildNotice(currentVersion: string, latestVersion: string | null): string | null {
  if (!latestVersion) return null;
  if (!isNewer(latestVersion, currentVersion)) return null;
  return `  Update available: ${currentVersion} → ${latestVersion}\n  Run \`agentv self update\` to upgrade.`;
}

/**
 * Fire-and-forget background check. Spawns a detached child process that
 * fetches latest version from npm and updates the cache file. The child
 * survives even if the parent calls process.exit().
 */
export function backgroundUpdateCheck(): void {
  const dir = AGENTV_DIR;
  const filePath = join(dir, CACHE_FILE);

  const script = `
    const https = require('https');
    const fs = require('fs');
    const dir = ${JSON.stringify(dir)};
    const filePath = ${JSON.stringify(filePath)};
    https.get(${JSON.stringify(NPM_REGISTRY_URL)}, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); process.exit(); }
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const v = JSON.parse(body).version;
          if (typeof v === 'string') {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify({ latestVersion: v, lastCheckedAt: new Date().toISOString() }, null, 2));
          }
        } catch {}
        process.exit();
      });
    }).on('error', () => process.exit()).on('timeout', function() { this.destroy(); process.exit(); });
  `;

  try {
    const child = spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {}
}

/**
 * Get the update notice to display, or null. Kicks off a background
 * refresh if the cache is stale. Never blocks startup.
 */
export async function getUpdateNotice(currentVersion: string): Promise<string | null> {
  if (process.env.AGENTV_NO_UPDATE_CHECK === '1' || process.env.CI === 'true') {
    return null;
  }
  const cache = await getCachedUpdateInfo();
  if (shouldCheck(cache)) {
    backgroundUpdateCheck();
  }
  return buildNotice(currentVersion, cache?.latestVersion ?? null);
}
