/**
 * App shell: sidebar + main content area.
 *
 * The sidebar provides navigation, and the main area renders the
 * active route via the Outlet.
 */

import { Outlet } from '@tanstack/react-router';

import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
