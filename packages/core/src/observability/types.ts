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
}

/** Preset configuration for a known observability backend. */
export interface OtelBackendPreset {
  readonly name: string;
  readonly endpoint: string;
  readonly headers: (env: Record<string, string | undefined>) => Record<string, string>;
}
