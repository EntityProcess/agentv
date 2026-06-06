/**
 * Breadcrumb navigation derived from TanStack Router matches.
 *
 * Maps route segments to human-readable labels and renders them as
 * clickable links (except the last segment, which is the current page).
 */

import { Link, useMatches } from '@tanstack/react-router';

import { useProjectList } from '~/lib/api';
import {
  categoryPath,
  evalPath,
  experimentPath,
  jobPath,
  projectHomePath,
  runPath,
  suitePath,
} from '~/lib/navigation';

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

function deriveSegments(
  matches: ReturnType<typeof useMatches>,
  projectNames: ReadonlyMap<string, string> = new Map(),
): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];

  // Skip the root match (index 0)
  for (let i = 1; i < matches.length; i++) {
    const match = matches[i];
    const routeId = match.routeId ?? match.id;
    const params = match.params as Record<string, string>;

    if (routeId === '/' || routeId === '/_layout') continue;

    if (routeId.includes('/projects/$projectId') && params.projectId) {
      const label = projectNames.get(params.projectId) ?? params.projectId;
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
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: jobPath(params.runId, params.projectId),
        });
      }
    } else if (routeId.includes('/projects/$projectId_/runs/$runId/category/$category')) {
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: runPath(params.runId, params.projectId),
        });
      }
      segments.push({
        label: params.category ?? 'Category',
        to: categoryPath(params.runId, params.category ?? 'Category', params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/runs/$runId/suite/$suite')) {
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: runPath(params.runId, params.projectId),
        });
      }
      segments.push({
        label: params.suite ?? 'Suite',
        to: suitePath(params.runId, params.suite ?? 'Suite', params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/runs/$runId')) {
      segments.push({
        label: formatRunLabel(params.runId),
        to: runPath(params.runId, params.projectId),
      });
    } else if (routeId.includes('/projects/$projectId_/evals/$runId/$evalId')) {
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
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
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: runPath(params.runId),
        });
      }
      segments.push({
        label: params.category ?? 'Category',
        to: categoryPath(params.runId, params.category ?? 'Category'),
      });
    } else if (routeId.includes('/runs/$runId/suite/$suite')) {
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
          to: runPath(params.runId),
        });
      }
      segments.push({
        label: params.suite ?? 'Suite',
        to: suitePath(params.runId, params.suite ?? 'Suite'),
      });
    } else if (routeId.includes('/jobs/$runId')) {
      segments.push({
        label: formatRunLabel(params.runId),
        to: jobPath(params.runId),
      });
    } else if (routeId.includes('/runs/$runId')) {
      segments.push({
        label: formatRunLabel(params.runId),
        to: runPath(params.runId),
      });
    } else if (routeId.includes('/evals/$runId/$evalId')) {
      // For eval pages, show the run as a parent segment too
      if (!segments.some((s) => s.label === formatRunLabel(params.runId))) {
        segments.push({
          label: formatRunLabel(params.runId),
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
    } else if (routeId === '/index' || routeId === '/') {
      segments.push({ label: 'Home', to: '/' });
    }
  }

  return segments;
}

export function Breadcrumbs() {
  const matches = useMatches();
  const { data: projectData } = useProjectList();
  const projectNames = new Map(
    (projectData?.projects ?? []).map((project) => [project.id, project.name]),
  );
  const segments = deriveSegments(matches, projectNames);

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
