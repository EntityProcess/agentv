/** Options for configuring the OTel trace exporter. */
export interface OtelExportOptions {
  /** OTLP endpoint URL */
  readonly endpoint?: string;
  /** Custom headers (e.g., auth) */
  readonly headers?: Record<string, string>;
  /** Whether to include message content in spans */
  readonly captureContent?: boolean;
  /** Service name for OTel resource */
  readonly serviceName?: string;
  /** When true, group messages into turn spans for multi-turn evals */
  readonly groupTurns?: boolean;
  /** Path to write OTLP JSON file (importable by OTel backends) */
  readonly otlpFilePath?: string;
  /** Path to write human-readable simple JSONL trace file */
  readonly traceFilePath?: string;
}

/** Preset configuration for a known observability backend. */
export interface OtelBackendPreset {
  readonly name: string;
  readonly endpoint: string;
  readonly headers: (env: Record<string, string | undefined>) => Record<string, string>;
}
