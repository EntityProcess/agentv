/**
 * Legacy project-scoped experiment detail route. Kept for one release so
 * bookmarked `/projects/<projectId>/experiments/<name>` links survive;
 * redirects to the generalized `/tags/experiment/<name>` view.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/projects/$projectId_/experiments/$experimentName')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/projects/$projectId/tags/$key/$value',
      params: {
        projectId: params.projectId,
        key: 'experiment',
        value: params.experimentName,
      },
    });
  },
});
