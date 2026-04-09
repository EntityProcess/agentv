/**
 * App shell: sidebar + breadcrumbs + main content area.
 *
 * The sidebar provides navigation, breadcrumbs show the current
 * location, and the main area renders the active route via Outlet.
 *
 * Responsive behavior:
 * - md+ (≥768px): sidebar always visible as a fixed left panel.
 * - <md: sidebar hidden by default; a hamburger in the mobile top bar toggles it.
 */

import { Outlet } from '@tanstack/react-router';

import { SidebarProvider, useSidebarContext } from '~/lib/sidebar-context';

import { Breadcrumbs } from './Breadcrumbs';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <SidebarProvider>
      <LayoutInner />
    </SidebarProvider>
  );
}

function LayoutInner() {
  const { toggle } = useSidebarContext();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar — only visible below md breakpoint */}
        <header className="flex items-center gap-3 border-b border-gray-800 bg-gray-900/50 px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={toggle}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Toggle navigation"
          >
            {/* Hamburger icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="Toggle navigation"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-white">AgentV Studio</span>
        </header>

        <Breadcrumbs />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
