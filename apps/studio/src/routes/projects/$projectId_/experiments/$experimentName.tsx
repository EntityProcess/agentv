/**
 * Project-scoped experiment detail route.
 */

import { createFileRoute } from '@tanstack/react-router';

import { ExperimentDetail } from '~/components/ExperimentDetail';

export const Route = createFileRoute('/projects/$projectId_/experiments/$experimentName')({
  component: ProjectExperimentDetailPage,
});

function ProjectExperimentDetailPage() {
  const { projectId, experimentName } = Route.useParams();
  return <ExperimentDetail experimentName={experimentName} projectId={projectId} />;
}
