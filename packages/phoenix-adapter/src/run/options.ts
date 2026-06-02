export interface RunOptions {
  readonly agentvRoot: string;
  readonly evalFile?: string;
  readonly filter?: string;
  readonly dryRun: boolean;
  readonly out: string;
  readonly namespace?: string;
  readonly failOnUnsupported: boolean;
}
