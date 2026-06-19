/**
 * Project card for the projects dashboard.
 *
 * Shows project name, path, run count, pass rate, and last run time.
 * Click navigates to the project's run list.
 */

import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';

import { executionErrorCount } from '~/lib/result-summary';
import type { ProjectSummary } from '~/lib/types';

function formatTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'No runs';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ProjectCardProps {
  project: ProjectSummary;
  canRemove?: boolean;
  onRemove?: (project: ProjectSummary) => Promise<void>;
}

export function ProjectCard({ project, canRemove = false, onRemove }: ProjectCardProps) {
  const passPercent = Math.round(project.pass_rate * 100);
  const errors = executionErrorCount(project);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const menuId = useId();
  const confirmTitleId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuButtonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (confirmOpen) {
      dialogRef.current?.focus();
    }
  }, [confirmOpen]);

  function openRemoveConfirmation() {
    setMenuOpen(false);
    setRemoveError(null);
    setConfirmOpen(true);
  }

  async function confirmRemoveProject() {
    if (!onRemove || removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onRemove(project);
    } catch (err) {
      setRemoveError((err as Error).message);
      setRemoving(false);
    }
  }

  function closeConfirmation() {
    if (removing) return;
    setConfirmOpen(false);
    setRemoveError(null);
    menuButtonRef.current?.focus();
  }

  return (
    <article className="group relative rounded-lg border border-gray-800 bg-gray-900/50 transition-colors hover:border-cyan-800 hover:bg-gray-900">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="block p-5 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-cyan-500"
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1 pr-10">
            <h3 className="truncate text-lg font-semibold text-white group-hover:text-cyan-400">
              {project.name}
            </h3>
            <p className="mt-1 truncate text-xs text-gray-500">{project.path}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-gray-500">Runs</p>
            <p className="text-lg font-semibold text-white">{project.run_count}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Pass Rate</p>
            <p
              className={`text-lg font-semibold ${
                project.run_count === 0
                  ? 'text-gray-500'
                  : passPercent >= 80
                    ? 'text-emerald-400'
                    : passPercent >= 50
                      ? 'text-yellow-400'
                      : 'text-red-400'
              }`}
            >
              {project.run_count > 0 ? `${passPercent}%` : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Errors</p>
            <p
              className={`text-lg font-semibold ${errors > 0 ? 'text-amber-300' : 'text-gray-500'}`}
            >
              {errors}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Last Run</p>
            <p className="text-sm text-gray-300">{formatTimeAgo(project.last_run)}</p>
          </div>
        </div>
      </Link>

      {canRemove && onRemove ? (
        <div className="absolute right-3 top-3 z-10">
          <button
            ref={menuButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={`Open ${project.name} project menu`}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <span aria-hidden="true">...</span>
          </button>
          {menuOpen ? (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`${project.name} actions`}
              className="absolute right-0 top-10 w-44 overflow-hidden rounded-md border border-gray-800 bg-gray-950 py-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={openRemoveConfirmation}
                className="block w-full px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-950/30 hover:text-red-300 focus:bg-red-950/30 focus:outline-none"
              >
                Remove project
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <dialog
          ref={dialogRef}
          open
          aria-modal="true"
          aria-labelledby={confirmTitleId}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeConfirmation();
            }
          }}
          className="fixed inset-0 z-50 flex h-full max-h-none w-full max-w-none items-center justify-center bg-black/70 p-4 text-left text-gray-100 backdrop:bg-black/70"
        >
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-xl">
            <div className="border-b border-gray-800 px-4 py-3">
              <h2 id={confirmTitleId} className="text-lg font-semibold text-white">
                Remove project?
              </h2>
            </div>
            <div className="space-y-3 p-4">
              <p className="text-sm text-gray-300">
                Remove <span className="font-medium text-white">{project.name}</span> from this
                Dashboard registry.
              </p>
              <p className="text-sm text-gray-500">
                The project folder and files stay on disk at {project.path}.
              </p>
              {removeError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-400"
                >
                  {removeError}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-900/50 px-4 py-3">
              <button
                type="button"
                onClick={closeConfirmation}
                disabled={removing}
                className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoveProject()}
                disabled={removing}
                className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:border-red-800 hover:bg-red-950/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removing ? 'Removing...' : 'Remove project'}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </article>
  );
}
