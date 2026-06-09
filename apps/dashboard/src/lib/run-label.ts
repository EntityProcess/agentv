import type { RunMeta } from './types';

type RunLabelInput = Pick<RunMeta, 'experiment' | 'target' | 'timestamp' | 'pass_rate'> &
  Partial<Pick<RunMeta, 'display_name' | 'filename'>> & {
    title?: string;
  };

export interface RunDisplay {
  primary: string;
  secondary: string;
  label: string;
  title: string;
}

interface RunDisplayOptions {
  includePassRate?: boolean;
}

const REMOTE_RUN_PREFIX = 'remote::';

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

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function nonDefaultExperiment(experiment: string | undefined): string | undefined {
  const trimmed = cleanOptional(experiment);
  return trimmed && trimmed !== 'default' && trimmed !== '-' ? trimmed : undefined;
}

function normalizeTimestampCandidate(value: string): string {
  let candidate = value.trim();
  if (candidate.startsWith(REMOTE_RUN_PREFIX)) {
    candidate = candidate.slice(REMOTE_RUN_PREFIX.length);
  }
  return candidate.replace(/\.(jsonl|json)$/i, '');
}

function parseRunTimestampLike(value: string): Date | undefined {
  const candidate = normalizeTimestampCandidate(value);
  const match = candidate.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})[:-](\d{2})[:-](\d{2})(?:[.-](\d{3}))?Z?$/,
  );
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second, millis = '000'] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isTimestampOnlyName(value: string | undefined, timestamp: string): boolean {
  const trimmed = cleanOptional(value);
  if (!trimmed) return false;

  if (parseRunTimestampLike(trimmed)) {
    return true;
  }

  return normalizeTimestampCandidate(trimmed) === shortTimestamp(timestamp);
}

function displayableFilename(filename: string | undefined, timestamp: string): string | undefined {
  const trimmed = cleanOptional(filename);
  if (!trimmed) return undefined;

  const withoutSource = trimmed.startsWith(REMOTE_RUN_PREFIX)
    ? trimmed.slice(REMOTE_RUN_PREFIX.length)
    : trimmed;
  const separatorIndex = withoutSource.lastIndexOf('::');
  if (separatorIndex !== -1) {
    const suffix = withoutSource.slice(separatorIndex + 2);
    if (isTimestampOnlyName(suffix, timestamp)) {
      return cleanOptional(withoutSource.slice(0, separatorIndex));
    }
  }

  return withoutSource;
}

function firstHumanName(run: RunLabelInput): string | undefined {
  const candidates = [
    cleanOptional(run.display_name),
    cleanOptional(run.title),
    displayableFilename(run.filename, run.timestamp),
  ];

  return candidates.find(
    (candidate): candidate is string =>
      Boolean(candidate) && !isTimestampOnlyName(candidate, run.timestamp),
  );
}

function formatPassRate(passRate: number): string {
  return `${Math.round(passRate * 100)}%`;
}

function buildRunDisplayTitle(run: RunLabelInput, label: string): string {
  const parts = [label];
  const filename = cleanOptional(run.filename);
  const displayName = cleanOptional(run.display_name);
  const title = cleanOptional(run.title);

  if (filename && filename !== label) parts.push(`Run ID: ${filename}`);
  if (displayName && displayName !== filename && displayName !== label) {
    parts.push(`Display name: ${displayName}`);
  }
  if (title && title !== displayName && title !== filename && title !== label) {
    parts.push(`Title: ${title}`);
  }
  parts.push(`Timestamp: ${run.timestamp}`);

  return parts.join('\n');
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

/**
 * Build compact run display parts for Dashboard tables and sidebars.
 *
 * Primary text is a human name when one exists, otherwise a non-default
 * experiment, otherwise a single compact timestamp. Raw run IDs stay available
 * in the tooltip title so timestamp-only remote IDs do not crowd list cells.
 */
export function formatRunDisplay(run: RunLabelInput, options: RunDisplayOptions = {}): RunDisplay {
  const timestampLabel = shortTimestamp(run.timestamp);
  const experiment = nonDefaultExperiment(run.experiment);
  const humanName = firstHumanName(run);
  const experimentName =
    experiment && !isTimestampOnlyName(experiment, run.timestamp) ? experiment : undefined;
  const primary = humanName ?? experimentName ?? timestampLabel;
  const includePassRate = options.includePassRate ?? true;
  const secondaryParts: string[] = [];

  if (primary !== timestampLabel) {
    secondaryParts.push(timestampLabel);
  }
  if (run.target && run.target !== primary) {
    secondaryParts.push(run.target);
  }
  if (experiment && experiment !== primary) {
    secondaryParts.push(experiment);
  }
  if (includePassRate) {
    secondaryParts.push(formatPassRate(run.pass_rate));
  }

  const secondary = secondaryParts.join(' · ');
  const label = secondary ? `${primary} · ${secondary}` : primary;

  return {
    primary,
    secondary,
    label,
    title: buildRunDisplayTitle(run, label),
  };
}

/** Format a run label consistently across tables and nav surfaces. */
export function formatRunLabel(run: RunLabelInput): string {
  return formatRunDisplay(run).label;
}
