import type { RunMeta } from './types';

type RunLabelInput = Pick<RunMeta, 'display_name' | 'experiment' | 'filename' | 'target'>;

/** Format a run label consistently across tables and nav surfaces. */
export function formatRunLabel(run: RunLabelInput): string {
  const parts = [run.target, run.experiment].filter(
    (part): part is string => !!part && part !== 'default' && part !== '-',
  );
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return run.display_name ?? run.filename;
}
