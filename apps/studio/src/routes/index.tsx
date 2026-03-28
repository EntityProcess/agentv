/**
 * Home route: displays the run list.
 */

import { createFileRoute } from '@tanstack/react-router';

import { RunList } from '~/components/RunList';
import { useRunList } from '~/lib/api';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { data, isLoading, error } = useRunList();

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-red-400">
        Failed to load runs: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Evaluation Runs</h1>
      <RunList runs={data?.runs ?? []} />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
      <div className="space-y-2">
        {['s1', 's2', 's3', 's4', 's5'].map((id) => (
          <div key={id} className="h-12 animate-pulse rounded-lg bg-gray-900" />
        ))}
      </div>
    </div>
  );
}
