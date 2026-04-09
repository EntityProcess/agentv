/**
 * Progress-bar pill: gradient blue fill proportional to rate, percentage text inside.
 * Used for pass rate and per-test score throughout Studio.
 */

interface PassRatePillProps {
  rate: number;
}

export function PassRatePill({ rate }: PassRatePillProps) {
  const pct = Math.round(rate * 100);
  return (
    <div className="relative h-5 w-20 overflow-hidden rounded-full bg-gray-800">
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 to-blue-600"
        style={{ width: `${pct}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-white">
        {pct}%
      </span>
    </div>
  );
}
