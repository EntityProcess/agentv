/**
 * App shell: sidebar + project context + breadcrumbs + main content area.
 *
 * The sidebar provides app navigation, the top bar shows active project
 * context, breadcrumbs show the current location, and the main area renders
 * the active route via Outlet.
 *
 * Responsive behavior:
 * - md+ (≥768px): sidebar always visible as a fixed left panel.
 * - <md: sidebar hidden by default; a hamburger in the mobile top bar toggles it.
 */

import { Outlet } from '@tanstack/react-router';

import { SidebarProvider } from '~/lib/sidebar-context';

import { Breadcrumbs } from './Breadcrumbs';
import { ProjectContextBar } from './ProjectContextBar';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <SidebarProvider>
      <LayoutInner />
    </SidebarProvider>
  );
}

function LayoutInner() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ProjectContextBar />
        <Breadcrumbs />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
