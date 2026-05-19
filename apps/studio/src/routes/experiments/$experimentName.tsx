/**
 * Experiment detail route for single-project mode.
 */

import { createFileRoute } from '@tanstack/react-router';

import { ExperimentDetail } from '~/components/ExperimentDetail';

export const Route = createFileRoute('/experiments/$experimentName')({
  component: ExperimentDetailPage,
});

function ExperimentDetailPage() {
  const { experimentName } = Route.useParams();
  return <ExperimentDetail experimentName={experimentName} />;
}
