import { formatEvalSourceDisplay } from '~/lib/run-detail-context';
import type { EvalResult } from '~/lib/types';

interface EvalSourceLabelProps {
  result: Pick<EvalResult, 'eval_path' | 'suite'>;
  className?: string;
}

export function EvalSourceLabel({ result, className = '' }: EvalSourceLabelProps) {
  const display = formatEvalSourceDisplay(result);
  if (!display) return null;

  return (
    <span className={`block truncate text-gray-500 ${className}`} title={display.title}>
      {display.label}
    </span>
  );
}
