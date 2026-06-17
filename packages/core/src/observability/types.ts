/** Options for configuring the OTel trace exporter. */
export interface OtelExportOptions {
  /** OTLP endpoint URL */
  readonly endpoint?: string;
  /** Custom headers (e.g., auth) */
  readonly headers?: Record<string, string>;
  /** Resource attributes to attach to the trace provider */
  readonly resourceAttributes?: Record<string, string | number | boolean>;
  /** Whether to include message content in spans */
  readonly captureContent?: boolean;
  /** Service name for OTel resource */
  readonly serviceName?: string;
  /** When true, group messages into turn spans for multi-turn evals */
  readonly groupTurns?: boolean;
  /** Path to write OTLP JSON file (importable by OTel backends) */
  readonly otlpFilePath?: string;
}

export interface OtelBackendResolverContext {
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
}

export interface OtelBackendResolution {
  readonly endpoint: string;
  readonly headers?: Record<string, string>;
  readonly resourceAttributes?: Record<string, string | number | boolean>;
  readonly warnings?: readonly string[];
}

/** Generic resolver contract for OTel backend endpoint/header/resource routing. */
export interface OtelBackendResolver {
  readonly name: string;
  resolve(context: OtelBackendResolverContext): OtelBackendResolution;
}
