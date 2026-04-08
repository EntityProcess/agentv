/**
 * Settings page for configuring AgentV Studio behavior.
 *
 * Reads and writes to .agentv/config.yaml via the /api/config endpoint.
 * Changes take effect immediately on page refresh.
 */

import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { DEFAULT_PASS_THRESHOLD, saveStudioConfig, useStudioConfig } from '~/lib/api';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const { data: config, isLoading } = useStudioConfig();
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentThreshold = config?.threshold ?? DEFAULT_PASS_THRESHOLD;
  const displayThreshold = threshold || String(currentThreshold);
  const isReadOnly = config?.read_only === true;

  const handleSave = async () => {
    const value = Number.parseFloat(threshold || String(currentThreshold));
    if (Number.isNaN(value) || value < 0 || value > 1) {
      setMessage({ type: 'error', text: 'Threshold must be a number between 0 and 1' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await saveStudioConfig({ threshold: value });
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      setThreshold('');
      setMessage({ type: 'success', text: 'Settings saved' });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Configure your AgentV Studio dashboard</p>
      </div>

      {/* Pass Threshold Card */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">Evaluation</h2>
        <p className="mt-1 text-sm text-gray-400">
          Configure how evaluation results are classified
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="pass-threshold" className="block text-sm font-medium text-gray-300">
              Pass Threshold
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Score at or above this value is considered passing. Default: {DEFAULT_PASS_THRESHOLD}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="pass-threshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={displayThreshold}
                onChange={(e) => setThreshold(e.target.value)}
                disabled={isReadOnly}
                className="w-32 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <span className="text-sm text-gray-400">
                ({Math.round((Number.parseFloat(displayThreshold) || 0) * 100)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          )}
          {isReadOnly && <span className="text-sm text-gray-400">Read-only mode is enabled.</span>}
          {message && (
            <span
              className={`text-sm ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>

      {/* Config file info */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-xs text-gray-500">
          Settings are stored in <code className="text-gray-400">.agentv/config.yaml</code>
        </p>
      </div>
    </div>
  );
}
