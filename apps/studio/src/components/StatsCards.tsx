/**
 * Overview stat bar for a run — compact inline layout matching table width.
 *
 * Shows: pass rate, passed, failed, total (and optional cost) in a single row.
 */

interface StatsCardsProps {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalCost?: number;
}

export function StatsCards({ total, passed, failed, passRate, totalCost }: StatsCardsProps) {
  const pct = Math.round(passRate * 100);
  const rateColor = pct >= 80 ? 'text-cyan-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex flex-wrap items-center gap-6 rounded-lg border border-gray-800 bg-gray-900/60 px-5 py-3">
      <Stat label="Pass Rate" value={`${pct}%`} accent={rateColor} large />
      <div className="h-6 w-px bg-gray-700" />
      <Stat label="Passed" value={String(passed)} accent="text-emerald-400" />
      <Stat label="Failed" value={String(failed)} accent="text-red-400" />
      <Stat label="Total" value={String(total)} />
      {totalCost !== undefined && (
        <>
          <div className="h-6 w-px bg-gray-700" />
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
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`tabular-nums font-semibold ${large ? 'text-2xl' : 'text-lg'} ${accent ?? 'text-white'}`}
      >
        {value}
      </span>
    </div>
  );
}
