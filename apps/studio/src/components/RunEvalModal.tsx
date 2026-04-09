/**
 * RunEvalModal — a compact wizard for launching eval runs from Studio.
 *
 * Two-step flow:
 *   Step 1: What to run (suite filter, test-id pills, target override)
 *   Step 2: Advanced options (threshold, workers) — collapsed by default
 *
 * Shows a CLI preview before launch, then tracks run status.
 *
 * Entry points pass optional prefill props (e.g., from a run detail page
 * or eval detail page) so the modal opens pre-populated.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useNavigate } from '@tanstack/react-router';
import {
  launchEvalRun,
  previewEvalCommand,
  useEvalDiscover,
  useEvalRunStatus,
  useEvalTargets,
} from '~/lib/api';
import type { RunEvalRequest } from '~/lib/types';

// ── Props ────────────────────────────────────────────────────────────────

export interface RunEvalModalProps {
  open: boolean;
  onClose: () => void;
  benchmarkId?: string;
  prefill?: {
    suiteFilter?: string;
    testIds?: string[];
    target?: string;
  };
}

// ── Component ────────────────────────────────────────────────────────────

export function RunEvalModal({ open, onClose, benchmarkId, prefill }: RunEvalModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Form state
  const [suiteFilter, setSuiteFilter] = useState(prefill?.suiteFilter ?? '');
  const [testIdInput, setTestIdInput] = useState('');
  const [testIds, setTestIds] = useState<string[]>(prefill?.testIds ?? []);
  const [target, setTarget] = useState(prefill?.target ?? '');
  const [threshold, setThreshold] = useState('');
  const [workers, setWorkers] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Run state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [cliPreview, setCliPreview] = useState<string | null>(null);

  // Data
  const { data: discoverData } = useEvalDiscover(benchmarkId);
  const { data: targetsData } = useEvalTargets(benchmarkId);
  const { data: runStatus } = useEvalRunStatus(activeRunId);

  const evalFiles = useMemo(() => discoverData?.eval_files ?? [], [discoverData]);
  const targetNames = useMemo(() => targetsData?.targets ?? [], [targetsData]);

  // Reset form when opening with new prefill
  useEffect(() => {
    if (open) {
      setSuiteFilter(prefill?.suiteFilter ?? '');
      setTestIds(prefill?.testIds ?? []);
      setTarget(prefill?.target ?? '');
      setTestIdInput('');
      setThreshold('');
      setWorkers('');
      setDryRun(false);
      setShowAdvanced(false);
      setActiveRunId(null);
      setError(null);
      setLaunching(false);
      setCliPreview(null);
    }
  }, [open, prefill]);

  // When run finishes, refresh the runs list
  useEffect(() => {
    if (runStatus?.status === 'finished' || runStatus?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  }, [runStatus?.status, queryClient]);

  // Build request body from form state
  const buildRequest = useCallback((): RunEvalRequest => {
    const req: RunEvalRequest = {};
    if (suiteFilter.trim()) req.suite_filter = suiteFilter.trim();
    if (testIds.length > 0) req.test_ids = testIds;
    if (target) req.target = target;
    if (threshold) req.threshold = Number.parseFloat(threshold);
    if (workers) req.workers = Number.parseInt(workers, 10);
    if (dryRun) req.dry_run = true;
    return req;
  }, [suiteFilter, testIds, target, threshold, workers, dryRun]);

  // Update CLI preview when form changes
  useEffect(() => {
    const req = buildRequest();
    if (!req.suite_filter && (!req.test_ids || req.test_ids.length === 0)) {
      setCliPreview(null);
      return;
    }
    previewEvalCommand(req, benchmarkId)
      .then((r) => setCliPreview(r.command))
      .catch(() => setCliPreview(null));
  }, [buildRequest, benchmarkId]);

  // Add a test ID pill
  function addTestId() {
    const trimmed = testIdInput.trim();
    if (trimmed && !testIds.includes(trimmed)) {
      setTestIds([...testIds, trimmed]);
    }
    setTestIdInput('');
  }

  function removeTestId(id: string) {
    setTestIds(testIds.filter((t) => t !== id));
  }

  // Launch
  async function handleLaunch() {
    setError(null);
    setLaunching(true);
    try {
      const req = buildRequest();
      const result = await launchEvalRun(req, benchmarkId);
      setActiveRunId(result.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  if (!open) return null;

  // ── Active run view ────────────────────────────────────────────────────

  if (activeRunId && runStatus) {
    function handleRunInBackground() {
      onClose();
      navigate({ to: '/', search: { tab: 'runs' } as Record<string, string> });
    }
    return (
      <ModalShell onClose={onClose} title="Eval Run">
        <RunStatusView
          status={runStatus}
          onClose={onClose}
          onRunInBackground={handleRunInBackground}
          runId={activeRunId}
        />
      </ModalShell>
    );
  }

  // ── Form view ──────────────────────────────────────────────────────────

  const canLaunch = !!(suiteFilter.trim() || testIds.length > 0);

  return (
    <ModalShell onClose={onClose} title="Run Eval">
      <div className="space-y-4">
        {/* Suite filter */}
        <div>
          <label htmlFor="suite-filter" className="mb-1 block text-sm font-medium text-gray-300">
            Suite Filter
          </label>
          <input
            id="suite-filter"
            type="text"
            value={suiteFilter}
            onChange={(e) => setSuiteFilter(e.target.value)}
            placeholder="evals/**/*.eval.yaml"
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
          />
          {evalFiles.length > 0 && !suiteFilter && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {evalFiles.slice(0, 5).map((f) => (
                <button
                  key={f.relative_path}
                  type="button"
                  onClick={() =>
                    setSuiteFilter((prev) =>
                      prev ? `${prev}, ${f.relative_path}` : f.relative_path,
                    )
                  }
                  className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                >
                  {f.relative_path}
                </button>
              ))}
              {evalFiles.length > 5 && (
                <span className="px-1 text-xs text-gray-500">+{evalFiles.length - 5} more</span>
              )}
            </div>
          )}
        </div>

        {/* Test ID filter */}
        <div>
          <label htmlFor="test-id-input" className="mb-1 block text-sm font-medium text-gray-300">
            Test ID Filter
          </label>
          <div className="flex gap-2">
            <input
              id="test-id-input"
              type="text"
              value={testIdInput}
              onChange={(e) => setTestIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTestId();
                }
              }}
              placeholder="auth-*, retrieval-basic"
              className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={addTestId}
              disabled={!testIdInput.trim()}
              className="rounded-md bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {testIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {testIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-900/40 px-2.5 py-0.5 text-xs text-cyan-300"
                >
                  {id}
                  <button
                    type="button"
                    onClick={() => removeTestId(id)}
                    className="text-cyan-400 hover:text-white"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Target override */}
        <div>
          <label htmlFor="target-override" className="mb-1 block text-sm font-medium text-gray-300">
            Target Override
          </label>
          <select
            id="target-override"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan-600 focus:outline-none"
          >
            <option value="">Use eval's configured target</option>
            {targetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Advanced options */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            {showAdvanced ? '▾' : '▸'} Advanced Options
          </button>
          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="threshold-input" className="mb-1 block text-xs text-gray-400">
                  Threshold (0–1)
                </label>
                <input
                  id="threshold-input"
                  type="number"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  min="0"
                  max="1"
                  step="0.1"
                  placeholder="0.8"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="workers-input" className="mb-1 block text-xs text-gray-400">
                  Workers
                </label>
                <input
                  id="workers-input"
                  type="number"
                  value={workers}
                  onChange={(e) => setWorkers(e.target.value)}
                  min="1"
                  max="50"
                  placeholder="3"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  Dry run (mock provider responses)
                </label>
              </div>
            </div>
          )}
        </div>

        {/* CLI preview */}
        {cliPreview && (
          <div className="rounded-md border border-gray-700 bg-gray-950 p-3">
            <div className="mb-1 text-xs text-gray-500">CLI Preview</div>
            <code className="block break-all text-xs text-cyan-300">{cliPreview}</code>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-950/20 p-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={!canLaunch || launching}
            className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {launching ? 'Launching…' : 'Run Now'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function ModalShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh]">
      <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function RunStatusView({
  status,
  onClose,
  onRunInBackground,
  runId,
}: {
  status: import('~/lib/types').EvalRunStatus;
  onClose: () => void;
  onRunInBackground?: () => void;
  runId?: string;
}) {
  const isTerminal = status.status === 'finished' || status.status === 'failed';

  const statusColors: Record<string, string> = {
    starting: 'text-yellow-400',
    running: 'text-cyan-400',
    finished: 'text-emerald-400',
    failed: 'text-red-400',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${statusColors[status.status] ?? 'text-gray-400'}`}>
          {status.status === 'running' && '●'}{' '}
          {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
        </span>
        {!isTerminal && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        )}
      </div>

      <div className="rounded-md border border-gray-700 bg-gray-950 p-3">
        <code className="block break-all text-xs text-cyan-300">{status.command}</code>
      </div>

      {status.stdout && (
        <div className="max-h-48 overflow-y-auto rounded-md bg-gray-950 p-3">
          <pre className="whitespace-pre-wrap text-xs text-gray-300">
            {status.stdout.slice(-3000)}
          </pre>
        </div>
      )}

      {status.stderr && (
        <div className="max-h-24 overflow-y-auto rounded-md bg-red-950/20 p-3">
          <pre className="whitespace-pre-wrap text-xs text-red-300">
            {status.stderr.slice(-2000)}
          </pre>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {isTerminal ? (
            <>
              Exit code: {status.exit_code}
              {status.finished_at && ` · ${new Date(status.finished_at).toLocaleTimeString()}`}
            </>
          ) : (
            runId && (
              <button
                type="button"
                onClick={onRunInBackground}
                className="text-xs text-gray-400 hover:text-cyan-400"
              >
                Run in background
              </button>
            )
          )}
        </span>
        {isTerminal && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-600"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
