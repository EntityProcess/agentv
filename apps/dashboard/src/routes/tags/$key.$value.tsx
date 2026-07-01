/**
 * Tag-value detail route for single-project mode (`/tags/<key>/<value>`).
 */

import { createFileRoute } from '@tanstack/react-router';

import { TagValueDetail } from '~/components/TagValueDetail';

export const Route = createFileRoute('/tags/$key/$value')({
  component: TagValueDetailPage,
});

function TagValueDetailPage() {
  const { key, value } = Route.useParams();
  return <TagValueDetail tagKey={key} tagValue={value} />;
}
