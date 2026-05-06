import type { RunMeta } from './types';

type RunLabelInput = Pick<RunMeta, 'experiment' | 'target' | 'timestamp' | 'pass_rate'>;

/** DD/MM HH:mm — short human-readable slice of the run's timestamp. */
function shortTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${min}`;
  } catch {
    return ts.slice(0, 10);
  }
}

/** Human-readable relative time string, e.g. "4 hr ago". */
export function timeAgo(ts: string): string {
  try {
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHour = Math.floor(diffMs / 3_600_000);
    if (diffHour < 24) return `${diffHour} hr ago`;
    const diffDay = Math.floor(diffMs / 86_400_000);
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  } catch {
    return '';
  }
}

/** Format a run label consistently across tables and nav surfaces. */
export function formatRunLabel(run: RunLabelInput): string {
  const parts: string[] = [shortTimestamp(run.timestamp)];

  if (run.target) parts.push(run.target);
  if (run.experiment && run.experiment !== 'default' && run.experiment !== '-') {
    parts.push(run.experiment);
  }

  parts.push(`${Math.round(run.pass_rate * 100)}%`);

  return parts.join(' · ');
}
