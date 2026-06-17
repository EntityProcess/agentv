import { formatSuiteDisplay } from '~/lib/run-detail-context';

interface EvalSuiteLabelProps {
  suite?: string;
  className?: string;
}

export function EvalSuiteLabel({ suite, className = '' }: EvalSuiteLabelProps) {
  const display = formatSuiteDisplay(suite);
  if (!display) return null;

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300 ${className}`}
      title={display.title}
    >
      <span className="truncate">{display.label}</span>
    </span>
  );
}
