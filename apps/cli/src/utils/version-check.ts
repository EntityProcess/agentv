import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface VersionInfo {
  latest_version: string;
  last_checked_at: string; // ISO-8601 timestamp
  dismissed_version?: string;
}

function getVersionFilePath(): string {
  const configDir = process.env.AGENTV_HOME || join(homedir(), '.agentv');
  return join(configDir, 'version.json');
}

function readVersionInfo(versionFile: string): VersionInfo | null {
  try {
    if (!existsSync(versionFile)) return null;
    const contents = readFileSync(versionFile, 'utf-8');
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

function shouldCheckForUpdate(info: VersionInfo | null): boolean {
  if (!info) return true;
  const lastChecked = new Date(info.last_checked_at);
  const now = new Date();
  const hoursSinceCheck = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);
  return hoursSinceCheck >= 20; // Check every 20 hours like Codex
}

export function parseVersion(v: string): [number, number, number] | null {
  const parts = v.trim().split('.');
  if (parts.length !== 3) return null;
  const [maj, min, pat] = parts.map(p => parseInt(p, 10));
  if (isNaN(maj) || isNaN(min) || isNaN(pat)) return null;
  return [maj, min, pat];
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  return l[0] > c[0] || (l[0] === c[0] && l[1] > c[1]) || (l[0] === c[0] && l[1] === c[1] && l[2] > c[2]);
}

function displayUpdateNotification(currentVersion: string, latestVersion: string): void {
  console.warn(`\n✨ Update available! ${currentVersion} → ${latestVersion}`);
  console.warn(`Run \`npm install -g agentv@latest\` to update.\n`);
}

export async function checkForUpdates(currentVersion: string): Promise<void> {
  const versionFile = getVersionFilePath();
  const info = readVersionInfo(versionFile);

  // Only check every 20 hours to avoid network calls on every run
  if (!shouldCheckForUpdate(info)) {
    // Use cached version info to display update notification if needed
    if (info && isNewer(info.latest_version, currentVersion)) {
      displayUpdateNotification(currentVersion, info.latest_version);
    }
    return;
  }

  // Background update check (non-blocking) - spawn async without awaiting
  setImmediate(async () => {
    try {
      const response = await fetch('https://registry.npmjs.org/agentv/latest', {
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      if (!response.ok) return;
      
      const data = await response.json() as { version: string };
      const latestVersion = data.version;
      
      // Update cache file
      const newInfo: VersionInfo = {
        latest_version: latestVersion,
        last_checked_at: new Date().toISOString(),
        dismissed_version: info?.dismissed_version
      };
      
      const configDir = join(versionFile, '..');
      if (!existsSync(configDir)) {
        require('fs').mkdirSync(configDir, { recursive: true });
      }
      writeFileSync(versionFile, JSON.stringify(newInfo) + '\n');
    } catch {
      // Silently ignore errors - network issues, etc.
    }
  });

  // Show notification from cached data if available
  if (info && isNewer(info.latest_version, currentVersion)) {
    displayUpdateNotification(currentVersion, info.latest_version);
  }
}
