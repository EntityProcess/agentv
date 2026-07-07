/**
 * Overview stat bar for a run — compact inline layout matching table width.
 *
 * Shows: pass rate, passed, failures, execution errors, total
 * (and optional cost) in a single row.
 */

interface StatsCardsProps {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  executionErrors?: number;
  totalCost?: number;
}

export function StatsCards({
  total,
  passed,
  failed,
  passRate,
  executionErrors = 0,
  totalCost,
}: StatsCardsProps) {
  const pct = Math.round(passRate * 100);
  const rateColor = pct >= 80 ? 'text-cyan-300' : pct >= 60 ? 'text-amber-300' : 'text-red-300';

  return (
    <div className="flex flex-wrap items-center gap-5 rounded-lg border border-cyan-950/70 bg-gray-950/80 px-5 py-3 ring-1 ring-white/5">
      <Stat label="Pass Rate" value={`${pct}%`} accent={rateColor} large />
      <div className="h-8 w-px bg-cyan-900/50" />
      <Stat label="Passed" value={String(passed)} accent="text-emerald-400" />
      <Stat label="Failures" value={String(failed)} accent="text-red-400" />
      {executionErrors > 0 && (
        <Stat label="Execution Errors" value={String(executionErrors)} accent="text-amber-400" />
      )}
      <Stat label="Total" value={String(total)} />
      {totalCost !== undefined && (
        <>
          <div className="h-8 w-px bg-cyan-900/50" />
          <Stat label="Cost" value={`$${totalCost.toFixed(4)}`} accent="text-amber-400" />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  large,
}: {
  label: string;
  value: string;
  accent?: string;
  large?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span
        className={`tabular-nums font-semibold ${large ? 'text-2xl' : 'text-lg'} ${accent ?? 'text-gray-100'}`}
      >
        {value}
      </span>
    </div>
  );
}
