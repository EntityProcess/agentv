/**
 * Legacy experiment detail route. Kept for one release so bookmarked
 * `/experiments/<name>` links survive; redirects to the generalized
 * `/tags/experiment/<name>` view.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/experiments/$experimentName')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/tags/$key/$value',
      params: { key: 'experiment', value: params.experimentName },
    });
  },
});
