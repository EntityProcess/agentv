/**
 * Project-scoped tag-value detail route
 * (`/projects/<projectId>/tags/<key>/<value>`).
 */

import { createFileRoute } from '@tanstack/react-router';

import { TagValueDetail } from '~/components/TagValueDetail';

export const Route = createFileRoute('/projects/$projectId_/tags/$key/$value')({
  component: ProjectTagValueDetailPage,
});

function ProjectTagValueDetailPage() {
  const { projectId, key, value } = Route.useParams();
  return <TagValueDetail tagKey={key} tagValue={value} projectId={projectId} />;
}
