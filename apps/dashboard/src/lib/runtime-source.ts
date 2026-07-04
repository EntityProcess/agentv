import type { RunRuntimeSource } from './types';

export function runtimeConfigSourceLabel(
  source: RunRuntimeSource['config_source'] | undefined,
): string {
  switch (source) {
    case 'inline_experiment':
      return 'Inline experiment config';
    case 'cli_flags':
      return 'CLI runtime flags';
    case 'mixed':
      return 'Mixed runtime config';
    case 'defaults':
      return 'Default runtime config';
    default:
      return 'Runtime config unknown';
  }
}

export function experimentNamespaceLabel(input: {
  experiment?: string;
  runtime_source?: RunRuntimeSource;
}): string {
  return input.experiment?.trim() || 'default';
}

export function runtimeSourceSummary(runtimeSource: RunRuntimeSource | undefined): string {
  if (!runtimeSource) {
    return 'Runtime source unknown';
  }
  return runtimeConfigSourceLabel(runtimeSource.config_source);
}

export function runtimeSourceTitle(runtimeSource: RunRuntimeSource | undefined): string {
  if (!runtimeSource) {
    return 'Runtime source metadata was not recorded for this run.';
  }
  const lines = [runtimeSourceSummary(runtimeSource)];
  if (runtimeSource.eval_files && runtimeSource.eval_files.length > 0) {
    lines.push(`Eval files: ${runtimeSource.eval_files.join(', ')}`);
  }
  if (runtimeSource.wrapper_eval_file) {
    lines.push(`Wrapper eval: ${runtimeSource.wrapper_eval_file}`);
  }
  return lines.join('\n');
}
