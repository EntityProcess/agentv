/**
 * Gradient score bar component.
 *
 * Renders a horizontal bar from cyan-400 to blue-500, proportional to the
 * score value (0..1). Used in run lists, dataset breakdowns, and eval detail.
 */

interface ScoreBarProps {
  score: number;
  className?: string;
}

export function ScoreBar({ score, className = '' }: ScoreBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-right text-sm font-medium tabular-nums text-gray-300">{pct}%</span>
    </div>
  );
}
