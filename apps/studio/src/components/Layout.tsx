/**
 * App shell: sidebar + breadcrumbs + main content area.
 *
 * The sidebar provides navigation, breadcrumbs show the current
 * location, and the main area renders the active route via Outlet.
 */

import { Outlet } from '@tanstack/react-router';

import { Breadcrumbs } from './Breadcrumbs';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Breadcrumbs />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
