import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addProjectApi, browseFilesystemApi } from '~/lib/api';
import type { FilesystemBrowseEntry, FilesystemBrowseResponse, ProjectEntry } from '~/lib/types';

interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (project: ProjectEntry) => void;
}

interface DirectoryRowProps {
  entry: FilesystemBrowseEntry;
  selected: boolean;
  current?: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

function DirectoryRow({ entry, selected, current = false, onSelect, onOpen }: DirectoryRowProps) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] border-b border-gray-800/50 last:border-b-0 ${
        selected ? 'bg-cyan-950/20' : 'transition-colors hover:bg-gray-900/30'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        aria-selected={selected}
        className="min-w-0 px-4 py-3 text-left focus:outline-none focus:ring-1 focus:ring-inset focus:ring-cyan-500"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-200">{entry.name}</span>
          {current ? (
            <span className="shrink-0 rounded-md border border-gray-700 px-2 py-0.5 text-xs font-medium text-gray-400">
              this folder
            </span>
          ) : null}
          {entry.hasAgentv ? (
            <span className="shrink-0 rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300">
              .agentv
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-gray-500">{entry.path}</span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="border-l border-gray-800 px-3 text-sm text-gray-400 transition-colors hover:bg-gray-900/40 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-cyan-500"
      >
        Open
      </button>
    </div>
  );
}

export function AddProjectModal({ open, onClose, onAdded }: AddProjectModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [browseData, setBrowseData] = useState<FilesystemBrowseResponse | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadPath = useCallback(
    async (nextPath?: string, options: { selectCurrent?: boolean } = {}) => {
      setLoading(true);
      setBrowseError(null);
      setSubmitError(null);
      try {
        const data = await browseFilesystemApi(nextPath);
        setBrowseData(data);
        setPathInput(data.path);
        setSelectedPath(options.selectCurrent && data.current.hasAgentv ? data.current.path : '');
      } catch (err) {
        setBrowseError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setBrowseData(null);
    setPathInput('');
    setSelectedPath('');
    setBrowseError(null);
    setSubmitError(null);
    setSubmitting(false);
    dialogRef.current?.focus();
    void loadPath(undefined, { selectCurrent: true });
  }, [loadPath, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const selectedEntry = useMemo(() => {
    if (!browseData || !selectedPath) return null;
    if (selectedPath === browseData.current.path) return browseData.current;
    return browseData.entries.find((entry) => entry.path === selectedPath) ?? null;
  }, [browseData, selectedPath]);

  const canSubmit = Boolean(selectedEntry?.hasAgentv) && !submitting;

  function handleBrowseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadPath(pathInput, { selectCurrent: true });
  }

  async function handleAddProject() {
    if (!selectedPath || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const project = await addProjectApi(selectedPath);
      onAdded(project);
      onClose();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const selectionMessage = selectedPath
    ? selectedEntry?.hasAgentv
      ? `Ready to add ${selectedEntry.name}.`
      : 'Selected folder does not contain an .agentv/ directory.'
    : 'Select a folder containing an .agentv/ directory.';

  return (
    <dialog
      ref={dialogRef}
      open
      aria-modal="true"
      aria-label="Add project"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex h-full max-h-none w-full max-w-none items-center justify-center bg-black/70 p-4 text-left text-gray-100 backdrop:bg-black/70"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-xl font-semibold text-white">Add project</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <form onSubmit={handleBrowseSubmit} className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="add-project-path">
              Folder path
            </label>
            <input
              id="add-project-path"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="Folder path"
              className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
              disabled={loading || submitting}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => browseData?.parentPath && void loadPath(browseData.parentPath)}
                disabled={!browseData?.parentPath || loading || submitting}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Up
              </button>
              <button
                type="button"
                onClick={() => void loadPath(pathInput)}
                disabled={loading || submitting}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                type="submit"
                disabled={loading || submitting}
                className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              >
                Go
              </button>
            </div>
          </form>

          {browseError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-400"
            >
              {browseError}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-gray-800">
            <div className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Current folder
              </p>
              <p className="mt-1 truncate text-sm text-gray-300">
                {browseData?.path ?? (loading ? 'Loading folders...' : 'No folder loaded')}
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {browseData ? (
                <>
                  <DirectoryRow
                    entry={browseData.current}
                    current
                    selected={selectedPath === browseData.current.path}
                    onSelect={() => setSelectedPath(browseData.current.path)}
                    onOpen={() => void loadPath(browseData.current.path, { selectCurrent: true })}
                  />
                  {browseData.entries.map((entry) => (
                    <DirectoryRow
                      key={entry.path}
                      entry={entry}
                      selected={selectedPath === entry.path}
                      onSelect={() => setSelectedPath(entry.path)}
                      onOpen={() => void loadPath(entry.path, { selectCurrent: true })}
                    />
                  ))}
                  {browseData.entries.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-gray-500">
                      No subfolders in this location.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-gray-500">
                  {loading ? 'Loading folders...' : 'Enter a folder path to browse.'}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  Selected
                </p>
                <p className="mt-1 truncate text-sm text-gray-200">{selectedPath || 'None'}</p>
              </div>
              <p
                className={`text-sm ${
                  selectedEntry?.hasAgentv ? 'text-cyan-300' : 'text-gray-500'
                }`}
              >
                {selectionMessage}
              </p>
            </div>
          </div>

          {submitError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-400"
            >
              {submitError}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-gray-800 bg-gray-900/50 px-4 py-3">
          <p className="text-xs tabular-nums text-gray-500">
            {browseData ? `${browseData.entries.length} folders` : '0 folders'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleAddProject()}
              disabled={!canSubmit}
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
            >
              {submitting ? 'Adding...' : 'Add project'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
