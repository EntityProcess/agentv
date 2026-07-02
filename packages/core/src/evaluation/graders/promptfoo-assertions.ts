import { execFileWithStdin } from '../../runtime/exec.js';
import { serializeSnakeCaseBoundaryPayload } from '../case-conversion.js';
import type {
  AssertSetGraderConfig,
  AssertionEntry,
  JsonObject,
  JsonValue,
  ScriptAssertionGraderConfig,
  SimilarGraderConfig,
} from '../types.js';
import { clampScore } from './scoring.js';
import type { EvaluationContext, EvaluationScore, Grader } from './types.js';

type ScriptResult =
  | boolean
  | number
  | {
      readonly pass?: boolean;
      readonly score?: number;
      readonly reason?: string;
      readonly assertions?: readonly AssertionEntry[];
      readonly details?: JsonObject;
    };

function buildAssertionContext(context: EvaluationContext): Record<string, unknown> {
  return {
    criteria: context.evalCase.criteria,
    expectedOutput: context.evalCase.expected_output,
    input: context.evalCase.input,
    metadata: context.evalCase.metadata ?? null,
    trace: context.trace ?? null,
    tokenUsage: context.tokenUsage ?? null,
    costUsd: context.costUsd ?? null,
    durationMs: context.durationMs ?? null,
    fileChanges: context.fileChanges ?? null,
    workspacePath: context.workspacePath ?? null,
    dependencyResults: context.dependencyResults ?? null,
  };
}

function normalizeScriptResult(
  result: ScriptResult,
  fallbackText: string,
  threshold?: number,
): EvaluationScore {
  const passThreshold = threshold ?? Number.EPSILON;
  if (typeof result === 'boolean') {
    return {
      score: result ? 1 : 0,
      verdict: result ? 'pass' : 'fail',
      assertions: [{ text: result ? 'Assertion passed' : fallbackText, passed: result }],
      expectedAspectCount: 1,
    };
  }

  if (typeof result === 'number') {
    const score = clampScore(result);
    const passed = score >= passThreshold;
    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      assertions: [{ text: passed ? 'Assertion passed' : fallbackText, passed }],
      expectedAspectCount: 1,
    };
  }

  const score =
    typeof result.score === 'number'
      ? clampScore(result.score)
      : result.pass === true
        ? 1
        : result.pass === false
          ? 0
          : 0;
  const passed = result.pass ?? score >= passThreshold;
  const assertions =
    result.assertions && result.assertions.length > 0
      ? result.assertions
      : [
          {
            text: result.reason ?? (passed ? 'Assertion passed' : fallbackText),
            passed,
          },
        ];
  return {
    score,
    verdict: passed ? 'pass' : 'fail',
    assertions,
    expectedAspectCount: assertions.length || 1,
    ...(result.details ? { details: result.details } : {}),
  };
}

function buildFunctionBody(code: string): string {
  const trimmed = code.trim().replace(/;+\s*$/, '');
  if (trimmed.includes('\n') || /\breturn\b/.test(trimmed)) {
    return trimmed;
  }
  const lastSemi = trimmed.lastIndexOf(';');
  if (/^(const|let|var)\s/.test(trimmed) && lastSemi >= 0) {
    return `${trimmed.slice(0, lastSemi + 1)} return ${trimmed.slice(lastSemi + 1).trim()}`;
  }
  return `return ${trimmed}`;
}

export class JavascriptAssertionGrader implements Grader {
  readonly kind = 'javascript';

  constructor(private readonly config: ScriptAssertionGraderConfig) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    try {
      const fn = new Function('output', 'context', buildFunctionBody(this.config.value));
      const result = (await fn(context.candidate, buildAssertionContext(context))) as ScriptResult;
      return normalizeScriptResult(
        result,
        'Javascript assertion returned a failing result',
        this.config.threshold,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Javascript assertion failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
      };
    }
  }
}

function buildPythonProgram(code: string): string {
  const isMultiline = code.includes('\n');
  const body = isMultiline
    ? code
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n')
    : `    return ${code}`;

  return `import json
import sys

payload = json.load(sys.stdin)

def main(output, context):
${body}

result = main(payload.get("output", ""), payload.get("context", {}))
print(json.dumps(result))
`;
}

export class PythonAssertionGrader implements Grader {
  readonly kind = 'python';

  constructor(
    private readonly config: ScriptAssertionGraderConfig,
    private readonly timeoutMs?: number,
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const payload = JSON.stringify({
      output: context.candidate,
      context: serializeSnakeCaseBoundaryPayload(buildAssertionContext(context)),
    });
    try {
      const result = await execFileWithStdin(
        ['python3', '-c', buildPythonProgram(this.config.value)],
        payload,
        {
          timeoutMs: this.timeoutMs,
        },
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `python exited with code ${result.exitCode}`);
      }
      const parsed = JSON.parse(result.stdout.trim()) as ScriptResult;
      return normalizeScriptResult(
        parsed,
        'Python assertion returned a failing result',
        this.config.threshold,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Python assertion failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
      };
    }
  }
}

export class WebhookAssertionGrader implements Grader {
  readonly kind = 'webhook';

  constructor(private readonly config: ScriptAssertionGraderConfig) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    try {
      const response = await fetch(this.config.value, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          output: context.candidate,
          context: serializeSnakeCaseBoundaryPayload(buildAssertionContext(context)),
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = (await response.json()) as ScriptResult;
      return normalizeScriptResult(
        result,
        'Webhook assertion returned a failing result',
        this.config.threshold,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Webhook assertion failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
      };
    }
  }
}

export class AssertSetGrader implements Grader {
  readonly kind = 'assert-set';

  constructor(
    private readonly config: AssertSetGraderConfig,
    private readonly createChild: (
      config: AssertSetGraderConfig['assertions'][number],
    ) => Promise<Grader>,
  ) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    const scores = [];
    for (const childConfig of this.config.assertions) {
      const child = await this.createChild(childConfig);
      const result = await child.evaluate(context);
      scores.push({
        name: childConfig.name,
        type: childConfig.type,
        score: result.score,
        weight: childConfig.weight ?? 1,
        verdict: result.verdict,
        assertions: result.assertions,
        graderRawRequest: result.graderRawRequest,
        scores: result.scores,
        details: result.details,
        tokenUsage: result.tokenUsage,
      });
    }

    const totalWeight = scores.reduce((sum, score) => sum + (score.weight ?? 1), 0) || 1;
    const score =
      scores.reduce((sum, item) => sum + item.score * (item.weight ?? 1), 0) / totalWeight;
    const threshold = this.config.threshold ?? 1;
    const passed = score >= threshold;
    return {
      score,
      verdict: passed ? 'pass' : 'fail',
      assertions: scores.flatMap((item) => item.assertions),
      expectedAspectCount: scores.reduce((sum, item) => sum + item.assertions.length, 0) || 1,
      scores,
      details: { threshold },
    };
  }
}

function getEmbeddingConfig(config: SimilarGraderConfig): JsonObject | undefined {
  const provider = typeof config.provider === 'object' ? config.provider : undefined;
  const nested =
    config.config?.embedding_provider && typeof config.config.embedding_provider === 'object'
      ? (config.config.embedding_provider as JsonObject)
      : undefined;
  return nested ?? provider ?? config.config;
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

async function embedTexts(
  config: SimilarGraderConfig,
  texts: readonly string[],
): Promise<number[][]> {
  const embedding = getEmbeddingConfig(config);
  const model = asString(embedding?.model);
  const rawBaseUrl = asString(embedding?.base_url) ?? asString(embedding?.endpoint);
  if (!embedding || !model || !rawBaseUrl) {
    throw new Error(
      'similar requires config.embedding_provider with OpenAI-compatible base_url and model',
    );
  }
  const apiKey = asString(embedding.api_key);
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`embedding provider returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: readonly { embedding?: readonly number[] }[] };
  const embeddings = json.data?.map((item) => [...(item.embedding ?? [])]) ?? [];
  if (embeddings.length !== texts.length || embeddings.some((item) => item.length === 0)) {
    throw new Error('embedding provider returned an invalid embeddings payload');
  }
  return embeddings;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

export class SimilarAssertionGrader implements Grader {
  readonly kind = 'similar';

  constructor(private readonly config: SimilarGraderConfig) {}

  async evaluate(context: EvaluationContext): Promise<EvaluationScore> {
    try {
      const [expected, actual] = await embedTexts(this.config, [
        this.config.value,
        context.candidate,
      ]);
      const similarity = clampScore((cosine(expected, actual) + 1) / 2);
      const threshold = this.config.threshold ?? 0.75;
      const passed = similarity >= threshold;
      return {
        score: similarity,
        verdict: passed ? 'pass' : 'fail',
        assertions: [
          {
            text: `Embedding similarity ${similarity.toFixed(3)} ${passed ? '>=' : '<'} ${threshold}`,
            passed,
          },
        ],
        expectedAspectCount: 1,
        details: { threshold, metric: 'cosine' },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        score: 0,
        verdict: 'fail',
        assertions: [{ text: `Similar assertion failed: ${message}`, passed: false }],
        expectedAspectCount: 1,
      };
    }
  }
}
