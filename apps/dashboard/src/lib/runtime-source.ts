import type { RunRuntimeSource } from './types';

export function runtimeKindLabel(kind: RunRuntimeSource['kind'] | undefined): string {
  switch (kind) {
    case 'direct_suite':
      return 'Direct suite';
    case 'wrapper_eval':
      return 'Wrapper eval';
    case 'multi_eval':
      return 'Multi-eval';
    default:
      return 'Unknown source';
  }
}

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
      return 'Unknown runtime config';
  }
}

export function experimentNamespaceSourceLabel(
  source: RunRuntimeSource['experiment_namespace_source'] | undefined,
): string {
  switch (source) {
    case 'cli':
      return 'CLI namespace';
    case 'eval_metadata':
      return 'Eval metadata namespace';
    case 'eval_filename':
      return 'Eval filename namespace';
    case 'multi_eval':
      return 'Multi-eval namespace';
    default:
      return 'Namespace source unknown';
  }
}

export function experimentNamespaceLabel(input: {
  experiment?: string;
  runtime_source?: RunRuntimeSource;
}): string {
  return (
    input.runtime_source?.experiment_namespace?.trim() || input.experiment?.trim() || 'default'
  );
}

export function runtimeSourceSummary(runtimeSource: RunRuntimeSource | undefined): string {
  if (!runtimeSource) {
    return 'Runtime source unknown';
  }
  return [
    runtimeKindLabel(runtimeSource.kind),
    experimentNamespaceSourceLabel(runtimeSource.experiment_namespace_source),
    runtimeConfigSourceLabel(runtimeSource.config_source),
  ].join(' · ');
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
  if (runtimeSource.source_eval_files && runtimeSource.source_eval_files.length > 0) {
    lines.push(`Source eval files: ${runtimeSource.source_eval_files.join(', ')}`);
  }
  return lines.join('\n');
}
