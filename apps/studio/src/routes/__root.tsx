/**
 * Root layout route.
 *
 * Wraps all pages in the app shell (sidebar + main content area).
 */

import { createRootRoute } from '@tanstack/react-router';

import { Layout } from '~/components/Layout';

export const Route = createRootRoute({
  component: Layout,
});
