/**
 * Gradient score bar component.
 *
 * Renders a horizontal bar from cyan-400 to blue-500, proportional to the
 * score value (0..1). Used in run lists, suite breakdowns, and eval detail.
 */

interface ScoreBarProps {
  score: number;
  className?: string;
  showLabel?: boolean;
}

export function ScoreBar({ score, className = '', showLabel = true }: ScoreBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tone =
    pct >= 80
      ? 'from-cyan-300 via-sky-400 to-blue-500'
      : pct >= 50
        ? 'from-amber-300 via-orange-400 to-red-400'
        : 'from-red-400 via-rose-500 to-fuchsia-500';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800/90 ring-1 ring-white/5">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel ? (
        <span className="w-12 text-right text-sm font-medium tabular-nums text-gray-200">
          {pct}%
        </span>
      ) : null}
    </div>
  );
}
