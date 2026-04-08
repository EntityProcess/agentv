/**
 * Breadcrumb navigation derived from TanStack Router matches.
 *
 * Maps route segments to human-readable labels and renders them as
 * clickable links (except the last segment, which is the current page).
 */

import { Link, useMatches } from '@tanstack/react-router';

interface BreadcrumbSegment {
  label: string;
  to?: string;
}

function formatRunLabel(runId: string | undefined): string {
  if (!runId) {
    return 'Run';
  }
  const [, timestamp] = runId.split('::');
  return timestamp || runId;
}

function deriveSegments(matches: ReturnType<typeof useMatches>): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];

  // Skip the root match (index 0)
  for (let i = 1; i < matches.length; i++) {
    const match = matches[i];
    const routeId = match.routeId ?? match.id;
    const params = match.params as Record<string, string>;

    if (routeId === '/' || routeId === '/_layout') continue;

    if (routeId.includes('/runs/$runId/category/$category')) {
      if (!segments.some((s) => s.label === params.runId)) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: `/runs/${encodeURIComponent(params.runId)}`,
        });
      }
      segments.push({
        label: params.category ?? 'Category',
        to: match.pathname,
      });
    } else if (routeId.includes('/runs/$runId/suite/$suite')) {
      segments.push({
        label: params.suite ?? 'Suite',
        to: match.pathname,
      });
    } else if (routeId.includes('/runs/$runId')) {
      segments.push({
        label: formatRunLabel(params.runId),
        to: match.pathname,
      });
    } else if (routeId.includes('/evals/$runId/$evalId')) {
      // For eval pages, show the run as a parent segment too
      if (!segments.some((s) => s.label === params.runId)) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: `/runs/${encodeURIComponent(params.runId)}`,
        });
      }
      segments.push({
        label: params.evalId ?? 'Eval',
        to: match.pathname,
      });
    } else if (routeId.includes('/experiments/$experimentName')) {
      segments.push({
        label: params.experimentName ?? 'Experiment',
        to: match.pathname,
      });
    } else if (routeId === '/index' || routeId === '/') {
      segments.push({ label: 'Home', to: '/' });
    }
  }

  return segments;
}

export function Breadcrumbs() {
  const matches = useMatches();
  const segments = deriveSegments(matches);

  if (segments.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-950 px-6 py-2 text-sm">
      <Link to="/" className="text-cyan-400 hover:text-cyan-300 hover:underline">
        Home
      </Link>

      {segments.map((segment, idx) => {
        const isLast = idx === segments.length - 1;

        return (
          <span key={`${segment.label}-${idx}`} className="flex items-center gap-2">
            <span className="text-gray-600">&gt;</span>
            {isLast ? (
              <span className="text-gray-400">{segment.label}</span>
            ) : (
              <Link
                to={segment.to ?? '/'}
                className="text-cyan-400 hover:text-cyan-300 hover:underline"
              >
                {segment.label}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}
