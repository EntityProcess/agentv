/**
 * Breadcrumb navigation derived from TanStack Router matches.
 *
 * Maps route segments to human-readable labels and renders them as
 * clickable links (except the last segment, which is the current page).
 */

import { Link, useMatches } from '@tanstack/react-router';

import {
  categoryPath,
  evalPath,
  experimentPath,
  jobPath,
  projectHomePath,
  runPath,
  suitePath,
} from '~/lib/navigation';
import { useSidebarContext } from '~/lib/sidebar-context';

interface BreadcrumbSegment {
  label: string;
  to?: string;
}

export function formatBreadcrumbRunLabel(runId: string | undefined): string {
  if (!runId) {
    return 'Run';
  }
  const candidate = runId.split('::').at(-1) || runId;
  const timestamp = candidate.match(/^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:[-.]\d+)?Z/);
  return timestamp?.[0] ?? candidate;
}

function deriveSegments(matches: ReturnType<typeof useMatches>): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];

  // Skip the root match (index 0)
  for (let i = 1; i < matches.length; i++) {
    const match = matches[i];
    const routeId = match.routeId ?? match.id;
    const params = match.params as Record<string, string>;

    if (routeId === '/' || routeId === '/_layout') continue;

    if (routeId.includes('/projects/$projectId') && params.projectId) {
      const label = params.projectId;
      const to = projectHomePath(params.projectId);
      if (!segments.some((s) => s.to === to)) {
        segments.push({
          label,
          to,
        });
      }
      if (routeId === '/projects/$projectId') {
        continue;
      }
    }

    if (routeId.includes('/projects/$projectId_/jobs/$runId')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: jobPath(params.runId, params.projectId),
        });
      }
    } else if (routeId.includes('/projects/$projectId_/runs/$runId/category/$category')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId, params.projectId),
        });
      }
      segments.push({
        label: params.category ?? 'Category',
        to: categoryPath(params.runId, params.category ?? 'Category', params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/runs/$runId/suite/$suite')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId, params.projectId),
        });
      }
      segments.push({
        label: params.suite ?? 'Suite',
        to: suitePath(params.runId, params.suite ?? 'Suite', params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/runs/$runId')) {
      segments.push({
        label: formatBreadcrumbRunLabel(params.runId),
        to: runPath(params.runId, params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/evals/$runId/$evalId')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId, params.projectId),
        });
      }
      segments.push({
        label: params.evalId ?? 'Eval',
        to: evalPath(params.runId, params.evalId ?? 'Eval', params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/experiments/$experimentName')) {
      segments.push({
        label: params.experimentName ?? 'Experiment',
        to: experimentPath(params.experimentName ?? 'Experiment', params.projectId),
      });
    } else if (routeId.includes('/runs/$runId/category/$category')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId),
        });
      }
      segments.push({
        label: params.category ?? 'Category',
        to: categoryPath(params.runId, params.category ?? 'Category'),
      });
    } else if (routeId.includes('/runs/$runId/suite/$suite')) {
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId),
        });
      }
      segments.push({
        label: params.suite ?? 'Suite',
        to: suitePath(params.runId, params.suite ?? 'Suite'),
      });
    } else if (routeId.includes('/jobs/$runId')) {
      segments.push({
        label: formatBreadcrumbRunLabel(params.runId),
        to: jobPath(params.runId),
      });
    } else if (routeId.includes('/runs/$runId')) {
      segments.push({
        label: formatBreadcrumbRunLabel(params.runId),
        to: runPath(params.runId),
      });
    } else if (routeId.includes('/evals/$runId/$evalId')) {
      // For eval pages, show the run as a parent segment too
      if (!segments.some((s) => s.label === formatBreadcrumbRunLabel(params.runId))) {
        segments.push({
          label: formatBreadcrumbRunLabel(params.runId),
          to: runPath(params.runId),
        });
      }
      segments.push({
        label: params.evalId ?? 'Eval',
        to: evalPath(params.runId, params.evalId ?? 'Eval'),
      });
    } else if (routeId.includes('/experiments/$experimentName')) {
      segments.push({
        label: params.experimentName ?? 'Experiment',
        to: experimentPath(params.experimentName ?? 'Experiment'),
      });
    } else if (routeId === '/settings') {
      segments.push({ label: 'Settings', to: '/settings' });
    }
  }

  return segments;
}

export function Breadcrumbs() {
  const matches = useMatches();
  const { toggle } = useSidebarContext();
  const segments = deriveSegments(matches);
  const hasTrail = segments.length > 0;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-h-12 min-w-0 items-center gap-2 border-b border-gray-800 bg-gray-950 px-4 py-2 text-sm md:px-6"
    >
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 text-gray-400 hover:text-gray-200 md:hidden"
        aria-label="Toggle navigation"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label="Toggle navigation"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="flex min-w-0 items-center gap-2">
        {hasTrail ? (
          <Link to="/" className="shrink-0 text-cyan-400 hover:text-cyan-300 hover:underline">
            Projects
          </Link>
        ) : (
          <span className="shrink-0 text-gray-400">Projects</span>
        )}

        {segments.map((segment, idx) => {
          const isLast = idx === segments.length - 1;

          return (
            <span key={`${segment.label}-${idx}`} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-gray-600">&gt;</span>
              {isLast ? (
                <span className="min-w-0 truncate text-gray-400">{segment.label}</span>
              ) : (
                <Link
                  to={segment.to ?? '/'}
                  className="min-w-0 truncate text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  {segment.label}
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
