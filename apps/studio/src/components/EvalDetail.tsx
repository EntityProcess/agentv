/**
 * Three-tab eval detail view: Steps (assertions), Output, and Task (input).
 *
 * Shows the full evaluation result with score breakdown, assertions list,
 * and Monaco viewers for output/input content.
 */

import { useState } from 'react';

import type { EvalResult } from '~/lib/types';

import { MonacoViewer } from './MonacoViewer';
import { ScoreBar } from './ScoreBar';

interface EvalDetailProps {
  eval: EvalResult;
}

type Tab = 'steps' | 'output' | 'task';

export function EvalDetail({ eval: result }: EvalDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('steps');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'steps', label: 'Steps' },
    { id: 'output', label: 'Output' },
    { id: 'task', label: 'Task' },
  ];

  return (
    <div className="space-y-6">
      {/* Score summary */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">{result.testId}</h3>
            <p className="mt-1 text-sm text-gray-400">
              {result.target && <span>Target: {result.target}</span>}
              {result.durationMs != null && (
                <span className="ml-4">{(result.durationMs / 1000).toFixed(1)}s</span>
              )}
              {result.costUsd != null && <span className="ml-4">${result.costUsd.toFixed(4)}</span>}
            </p>
          </div>
          <div className="w-48">
            <ScoreBar score={result.score} />
          </div>
        </div>
      </div>

      {/* Per-evaluator scores */}
      {result.scores && result.scores.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h4 className="mb-3 text-sm font-medium text-gray-400">Evaluator Scores</h4>
          <div className="space-y-3">
            {result.scores.map((s, i) => (
              <div key={`${s.name ?? s.type ?? i}`} className="flex items-center gap-4">
                <span className="w-40 truncate text-sm text-gray-300">
                  {s.name ?? s.type ?? `Score ${i + 1}`}
                </span>
                <div className="flex-1">
                  <ScoreBar score={s.score} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab navigation */}
      <div className="border-b border-gray-800">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-cyan-400 text-cyan-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'steps' && <StepsTab result={result} />}
        {activeTab === 'output' && <OutputTab result={result} />}
        {activeTab === 'task' && <TaskTab result={result} />}
      </div>
    </div>
  );
}

function StepsTab({ result }: { result: EvalResult }) {
  const assertions = result.assertions ?? [];
  const hasFailed =
    result.score < 1 || result.executionStatus === 'error' || result.executionStatus === 'failed';

  // Collect failure reasons from multiple sources
  const failureReasons: string[] = [];
  if (result.error) failureReasons.push(result.error);
  if (result.executionStatus === 'error' || result.executionStatus === 'failed') {
    failureReasons.push(`Execution status: ${result.executionStatus}`);
  }
  // Add failed assertion details
  const failedAssertions = assertions.filter((a) => !a.passed);
  for (const a of failedAssertions) {
    const msg = a.evidence ? `${a.text}: ${a.evidence}` : a.text;
    failureReasons.push(msg);
  }
  // Also check per-evaluator scores for failure details
  if (result.scores) {
    for (const s of result.scores) {
      if (s.score < 1 && s.details)
        failureReasons.push(`[${s.name ?? s.type ?? 'evaluator'}] ${s.details}`);
      if (s.assertions) {
        for (const a of s.assertions) {
          if (!a.passed) {
            const msg = a.evidence ? `${a.text}: ${a.evidence}` : a.text;
            if (!failureReasons.includes(msg)) failureReasons.push(msg);
          }
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      {assertions.length === 0 && (
        <p className="text-sm text-gray-500">No assertion steps recorded.</p>
      )}

      {assertions.length > 0 && (
        <div className="space-y-2">
          {assertions.map((a) => (
            <div
              key={`${a.text}-${a.passed}`}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                a.passed
                  ? 'border-emerald-900/50 bg-emerald-950/20'
                  : 'border-red-900/50 bg-red-950/20'
              }`}
            >
              <span className={`mt-0.5 text-lg ${a.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {a.passed ? '\u2713' : '\u2717'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200">{a.text}</p>
                {a.evidence && <p className="mt-1 text-xs text-gray-400">{a.evidence}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Failure reason section */}
      {hasFailed && failureReasons.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <h4 className="mb-2 text-sm font-medium text-red-400">Failure Reason</h4>
          <div className="space-y-2">
            {failureReasons.map((reason) => (
              <p key={reason} className="text-sm text-gray-300">
                {reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OutputTab({ result }: { result: EvalResult }) {
  const output = result.output;

  if (!output || output.length === 0) {
    return <p className="text-sm text-gray-500">No output available.</p>;
  }

  const text = output.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  return <MonacoViewer value={text} language="markdown" />;
}

function TaskTab({ result }: { result: EvalResult }) {
  const input = result.input;

  if (!input || input.length === 0) {
    return <p className="text-sm text-gray-500">No task input available.</p>;
  }

  const text = input.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  return <MonacoViewer value={text} language="markdown" />;
}
