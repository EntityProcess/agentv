/**
 * Benchmark card for the multi-benchmark dashboard.
 *
 * Shows benchmark name, path, run count, pass rate, and last run time.
 * Click navigates to the benchmark's run list.
 */

import { Link } from '@tanstack/react-router';

import type { BenchmarkSummary } from '~/lib/types';

function formatTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'No runs';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BenchmarkCard({ benchmark }: { benchmark: BenchmarkSummary }) {
  const passPercent = Math.round(benchmark.pass_rate * 100);

  return (
    <Link
      to="/benchmarks/$benchmarkId"
      params={{ benchmarkId: benchmark.id }}
      className="group block rounded-lg border border-gray-800 bg-gray-900/50 p-5 transition-colors hover:border-cyan-800 hover:bg-gray-900"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-white group-hover:text-cyan-400">
            {benchmark.name}
          </h3>
          <p className="mt-1 truncate text-xs text-gray-500">{benchmark.path}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-gray-500">Runs</p>
          <p className="text-lg font-semibold text-white">{benchmark.run_count}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Pass Rate</p>
          <p
            className={`text-lg font-semibold ${
              benchmark.run_count === 0
                ? 'text-gray-500'
                : passPercent >= 80
                  ? 'text-emerald-400'
                  : passPercent >= 50
                    ? 'text-yellow-400'
                    : 'text-red-400'
            }`}
          >
            {benchmark.run_count > 0 ? `${passPercent}%` : '--'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last Run</p>
          <p className="text-sm text-gray-300">{formatTimeAgo(benchmark.last_run)}</p>
        </div>
      </div>
    </Link>
  );
}
