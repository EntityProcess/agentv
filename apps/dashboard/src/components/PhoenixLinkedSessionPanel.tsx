import { useState } from 'react';

import { usePhoenixLinkedSession } from '~/lib/api';
import type {
  PhoenixLinkedSessionResponse,
  PhoenixLinkedSessionSpan,
  PhoenixLinkedSessionTokenUsage,
  PhoenixLinkedSessionTraceNode,
} from '~/lib/types';

interface PhoenixLinkedSessionPanelProps {
  runId: string;
  projectId?: string;
}

interface PhoenixLinkedSessionPanelContentProps {
  response: PhoenixLinkedSessionResponse;
  initialSpanId?: string;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatCost(value: number | undefined): string {
  if (value === undefined || value <= 0) return 'n/a';
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatTokenUsage(usage: PhoenixLinkedSessionTokenUsage | undefined): string {
  if (!usage) return 'n/a';
  const total =
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0) + (usage.cached ?? 0);
  return total > 0 ? total.toLocaleString() : 'n/a';
}

function formatDateTime(value: string | undefined): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function valuePreview(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactPreview(value: unknown): string {
  return valuePreview(value).replace(/\s+/g, ' ').trim();
}

function statusClass(status: PhoenixLinkedSessionResponse['status']): string {
  if (status === 'ok') return 'border-emerald-800 bg-emerald-950/40 text-emerald-300';
  if (status === 'not_configured' || status === 'unresolved') {
    return 'border-amber-800 bg-amber-950/40 text-amber-300';
  }
  return 'border-red-800 bg-red-950/40 text-red-300';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-gray-200" title={value}>
        {value}
      </div>
    </div>
  );
}

function OpenInPhoenixLink({ href }: { href?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-md border border-cyan-900/70 px-2.5 py-1 text-xs font-medium text-cyan-300 transition-colors hover:border-cyan-700 hover:bg-cyan-950/40"
    >
      Open in Phoenix
    </a>
  );
}

function ErrorState({ response }: { response: PhoenixLinkedSessionResponse }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-200">Phoenix Session</h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">{response.message}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs ${statusClass(response.status)}`}>
            {response.status}
          </span>
          <OpenInPhoenixLink href={response.open_in_phoenix_url} />
        </div>
      </div>
    </div>
  );
}

function SpanTree({
  nodes,
  selectedSpanId,
  onSelect,
}: {
  nodes: readonly PhoenixLinkedSessionTraceNode[];
  selectedSpanId?: string;
  onSelect: (spanId: string) => void;
}) {
  if (nodes.length === 0) {
    return <div className="text-sm text-gray-500">No span tree returned.</div>;
  }

  return (
    <div className="max-h-72 overflow-auto rounded-md border border-gray-800">
      {nodes.map((node) => {
        const active = node.span_id === selectedSpanId;
        return (
          <button
            key={`${node.trace_id ?? 'trace'}:${node.span_id}`}
            type="button"
            onClick={() => onSelect(node.span_id)}
            className={`grid w-full grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 border-b border-gray-800/60 px-3 py-2 text-left text-xs last:border-b-0 ${
              active ? 'bg-cyan-950/30 text-cyan-200' : 'text-gray-300 hover:bg-gray-900'
            }`}
            style={{ paddingLeft: `${12 + node.depth * 18}px` }}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{node.name ?? node.span_id}</span>
              <span className="block truncate text-gray-500">{node.span_kind ?? node.span_id}</span>
            </span>
            <span className="text-right tabular-nums text-gray-500">
              {formatDuration(node.duration_ms)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SpanDetail({ span }: { span?: PhoenixLinkedSessionSpan }) {
  if (!span) {
    return <div className="text-sm text-gray-500">No span selected.</div>;
  }

  return (
    <div className="rounded-md border border-gray-800 bg-black/40">
      <div className="grid gap-3 border-b border-gray-800 p-3 text-xs sm:grid-cols-3">
        <Metric label="Span" value={span.name ?? span.span_id} />
        <Metric label="Status" value={span.status ?? 'n/a'} />
        <Metric label="Tokens" value={formatTokenUsage(span.token_usage)} />
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-gray-800 p-3 md:border-r md:border-b-0">
          <div className="mb-2 text-xs font-medium text-gray-400">Input</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-200">
            {valuePreview(span.input)}
          </pre>
        </div>
        <div className="p-3">
          <div className="mb-2 text-xs font-medium text-gray-400">Output</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-200">
            {valuePreview(span.output)}
          </pre>
        </div>
      </div>
      {span.attributes ? (
        <div className="border-t border-gray-800 p-3">
          <div className="mb-2 text-xs font-medium text-gray-400">Attributes</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-300">
            {valuePreview(span.attributes)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function PhoenixLinkedSessionPanelContent({
  response,
  initialSpanId,
}: PhoenixLinkedSessionPanelContentProps) {
  const tree = response.trace_tree ?? [];
  const spans = response.spans ?? [];
  const [selectedSpanId, setSelectedSpanId] = useState(
    initialSpanId ?? tree[0]?.span_id ?? spans[0]?.span_id,
  );

  if (response.status === 'missing_external_trace') {
    return null;
  }

  if (response.status !== 'ok') {
    return <ErrorState response={response} />;
  }

  const selectedSpan =
    spans.find((span) => span.span_id === selectedSpanId) ??
    tree.find((span) => span.span_id === selectedSpanId) ??
    spans[0] ??
    tree[0];
  const session = response.session;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-gray-200">Phoenix Session</h3>
            <span className={`rounded-md border px-2 py-1 text-xs ${statusClass(response.status)}`}>
              linked
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-gray-400">
            {session?.session_id ?? response.external_trace?.session_id ?? 'session'}
          </p>
        </div>
        <OpenInPhoenixLink href={response.open_in_phoenix_url} />
      </div>

      <div className="grid gap-4 border-b border-gray-800 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric
          label="Traces"
          value={String(session?.trace_count ?? response.turns?.length ?? 0)}
        />
        <Metric label="Duration" value={formatDuration(session?.duration_ms)} />
        <Metric label="Tokens" value={formatTokenUsage(session?.token_usage)} />
        <Metric label="Cost" value={formatCost(session?.cost_usd)} />
        <Metric label="Started" value={formatDateTime(session?.start_time)} />
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">Turns</h4>
            <div className="max-h-72 overflow-auto rounded-md border border-gray-800">
              {(response.turns ?? []).map((turn) => (
                <div
                  key={`${turn.index}:${turn.trace_id ?? ''}`}
                  className="grid gap-2 border-b border-gray-800/60 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_7rem]"
                >
                  <span className="tabular-nums text-gray-500">#{turn.index}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-gray-300">
                      {compactPreview(turn.input) || turn.trace_id || 'trace'}
                    </span>
                    <span className="block truncate text-gray-500">
                      {compactPreview(turn.output)}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-gray-500">
                    {formatDuration(turn.duration_ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">Trace Tree</h4>
            <SpanTree
              nodes={tree}
              selectedSpanId={selectedSpan?.span_id}
              onSelect={setSelectedSpanId}
            />
          </div>
        </div>

        <div className="min-w-0">
          <h4 className="mb-2 text-xs font-medium uppercase text-gray-500">Span Details</h4>
          <SpanDetail span={selectedSpan} />
        </div>
      </div>
    </div>
  );
}

export function PhoenixLinkedSessionPanel({ runId, projectId }: PhoenixLinkedSessionPanelProps) {
  const { data, isLoading, error } = usePhoenixLinkedSession(runId, projectId);

  if (data?.status === 'missing_external_trace') {
    return null;
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 text-sm text-gray-400">
        Loading Phoenix session...
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        response={{
          schema_version: 'agentv.dashboard.phoenix_session.v1',
          status: 'unreachable',
          message: (error as Error).message,
        }}
      />
    );
  }

  return data ? <PhoenixLinkedSessionPanelContent response={data} /> : null;
}
