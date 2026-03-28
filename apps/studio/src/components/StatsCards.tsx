/**
 * Overview stat cards for a run or the global index.
 *
 * Shows: total evals, passed, failed, pass rate, and total cost.
 */

interface StatsCardsProps {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalCost?: number;
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-sm text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

export function StatsCards({ total, passed, failed, passRate, totalCost }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Card label="Total" value={String(total)} />
      <Card label="Passed" value={String(passed)} accent="text-emerald-400" />
      <Card label="Failed" value={String(failed)} accent="text-red-400" />
      <Card label="Pass Rate" value={`${Math.round(passRate * 100)}%`} accent="text-cyan-400" />
      {totalCost !== undefined && (
        <Card label="Cost" value={`$${totalCost.toFixed(4)}`} accent="text-amber-400" />
      )}
    </div>
  );
}
