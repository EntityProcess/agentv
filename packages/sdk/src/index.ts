/**
 * AgentV Evaluation SDK
 *
 * Build custom graders for AI agent outputs.
 *
 * @example Custom assertion (simplest way to add evaluation logic)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineAssertion } from '@agentv/sdk';
 *
 * export default defineAssertion(({ output, criteria }) => {
 *   const answer = output ?? '';
 *   return {
 *     pass: answer.includes('hello'),
 *     assertions: [{ text: 'Checks greeting', passed: answer.includes('hello') }],
 *   };
 * }));
 * ```
 *
 * @example Code grader (full control)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineCodeGrader } from '@agentv/sdk';
 *
 * export default defineCodeGrader(({ output, traceSummary }) => {
 *   return {
 *     score: (output ?? '').length > 0 && (traceSummary?.eventCount ?? 0) <= 5 ? 1.0 : 0.5,
 *     assertions: [
 *       { text: 'Answer is not empty', passed: (output ?? '').length > 0 },
 *       { text: 'Efficient tool usage', passed: (traceSummary?.eventCount ?? 0) <= 5 },
 *     ],
 *   };
 * }));
 * ```
 *
 * @example Vitest workspace verifier adapter (custom wrapper form)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineVitestWorkspaceGrader } from '@agentv/sdk';
 *
 * export default defineVitestWorkspaceGrader({
 *   testFile: 'graders/welcome-banner.test.ts',
 *   copyTestFilesToWorkspace: true,
 * });
 * ```
 *
 * @example Workspace grader (small file checks)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineWorkspaceGrader } from '@agentv/sdk';
 *
 * export default defineWorkspaceGrader(async ({ workspace }) => [
 *   await workspace.file('app/page.tsx').contains('Status: All systems ready'),
 *   await workspace.file('app/page.tsx').contains('Open dashboard'),
 *   await workspace.file('app/page.tsx').matches(/href=["']\/dashboard["']/),
 *   await workspace.file('app/page.tsx').notMatches(/TODO/i),
 * ]);
 * ```
 *
 * @packageDocumentation
 */

// Re-export schemas and types
export {
  CodeGraderInputSchema,
  CodeGraderResultSchema,
  TRACE_REDACTION_LEVELS,
  TRACE_SOURCE_KINDS,
  TRACE_EVENT_TYPES,
  TRACE_TOOL_STATUSES,
  TraceSummarySchema,
  TraceSchema,
  TraceArtifactSchema,
  TraceRawEvidenceSchema,
  TraceRedactionStateSchema,
  TraceBranchSchema,
  TraceErrorSchema,
  TraceEventSchema,
  TraceMessageSchema,
  TraceModelSchema,
  TraceSessionSchema,
  TraceSourceRefSchema,
  TraceSourceSchema,
  TraceToolSchema,
  MessageSchema,
  ToolCallSchema,
  TokenUsageSchema,
  PromptTemplateInputSchema,
  ContentTextSchema,
  ContentImageSchema,
  ContentFileSchema,
  ContentSchema,
  type CodeGraderInput,
  type CodeGraderResult,
  type TraceArtifact,
  type TraceRawEvidence,
  type TraceRedactionState,
  type TraceBranch,
  type TraceError,
  type TraceEvent,
  type TraceMessage,
  type TraceModel,
  type TraceSession,
  type TraceSource,
  type TraceSourceRef,
  type TraceTool,
  type TraceSummary,
  type Trace,
  type Message,
  type ToolCall,
  type TokenUsage,
  type PromptTemplateInput,
  type ContentText,
  type ContentImage,
  type ContentFile,
  type Content,
} from './schemas.js';

// Re-export YAML-aligned eval authoring helpers
export {
  evaluate,
  type AssertEntry,
  type ConversationTurnInput,
  type EvalAssertionInput,
  type EvalConfig,
  type EvalRunArtifacts,
  type EvalRunResult,
  type EvalSummary,
  type EvalTestInput,
} from '@agentv/core';

export {
  defineEval,
  evalSuite,
  serializeEvalYaml,
  toEvalYamlObject,
  type DefinedEvalSuite,
  type EvalAssertionConfig,
  type EvalDefinition,
  type EvalDockerWorkspace,
  type EvalExecution,
  type EvalMessage,
  type EvalMessageContent,
  type EvalPreprocessor,
  type EvalRequires,
  type EvalTargetRef,
  type EvalTest,
  type EvalTurn,
  type EvalWorkspace,
  type EvalWorkspaceHook,
  type EvalWorkspaceHooks,
  type EvalWorkspaceRepo,
  type LowerEvalYamlValue,
} from './eval.js';

// Re-export grader config helpers
export {
  codeGrader,
  containsGrader,
  equalsGrader,
  exactGrader,
  graders,
  isJsonGrader,
  jsonGrader,
  llmGrader,
  regexGrader,
  rubricsGrader,
  type CodeGraderConfig,
  type CodeGraderOptions,
  type CodeGraderTargetOptions,
  type ContainsGraderConfig,
  type EqualsGraderConfig,
  type GraderCatalog,
  type GraderCommand,
  type GraderCommonConfig,
  type GraderHelperConfig,
  type GraderHelperOptions,
  type GraderPromptScriptConfig,
  type GraderRubric,
  type GraderRubricCriterion,
  type GraderRubricOperator,
  type GraderScoreRange,
  type IsJsonGraderConfig,
  type LlmGraderConfig,
  type LlmGraderOptions,
  type RegexGraderConfig,
  type RegexGraderOptions,
  type RubricsGraderConfig,
} from './graders.js';

// Re-export target client
export {
  createTargetClient,
  TargetNotAvailableError,
  TargetInvocationError,
  type TargetClient,
  type TargetInfo,
  type TargetInvokeRequest,
  type TargetInvokeResponse,
} from './target-client.js';

// Re-export workspace grader helpers
export {
  createWorkspace,
  defineWorkspaceGrader,
  normalizeWorkspaceGraderResult,
  runWorkspaceGrader,
  type Workspace,
  type WorkspaceAssertion,
  type WorkspaceFile,
  type WorkspaceFileAssertionOptions,
  type WorkspaceGraderContext,
  type WorkspaceGraderHandler,
  type WorkspaceGraderReturn,
} from './workspace.js';

// Re-export Vitest workspace verifier adapter
export {
  defineVitestWorkspaceGrader,
  runVitestWorkspaceGrader,
  vitestReportToCodeGraderResult,
  type VitestWorkspaceGraderOptions,
} from './vitest.js';

// Re-export Zod for typed config support
export { z } from 'zod';

// Re-export assertion types
export type {
  AssertionContext,
  AssertionHandler,
  AssertionScore,
  AssertionType,
} from './assertion.js';

import { type AssertionHandler, runAssertion } from './assertion.js';
import { type PromptTemplateHandler, runPromptTemplate } from './prompt-template.js';
import { type CodeGraderHandler, runCodeGrader } from './runtime.js';

export { runCodeGrader };
export type { CodeGraderHandler };
export type { PromptTemplateHandler };

/**
 * Define a code grader with automatic stdin/stdout handling.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed input
 * 4. Validates the result and outputs JSON to stdout
 * 5. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that evaluates the input and returns a result
 *
 * @example
 * ```typescript
 * import { defineCodeGrader } from '@agentv/sdk';
 *
 * export default defineCodeGrader(({ trace }) => {
 *   if (!trace) {
 *     return { score: 0.5, assertions: [{ text: 'No trace available', passed: false }] };
 *   }
 *
 *   const efficient = trace.eventCount <= 10;
 *   return {
 *     score: efficient ? 1.0 : 0.5,
 *     assertions: [{ text: efficient ? 'Efficient execution' : 'Too many tool calls', passed: efficient }],
 *   };
 * });
 * ```
 *
 * @example With typed config
 * ```typescript
 * import { defineCodeGrader, z } from '@agentv/sdk';
 *
 * const ConfigSchema = z.object({
 *   maxToolCalls: z.number().default(10),
 * });
 *
 * export default defineCodeGrader(({ trace, config }) => {
 *   const { maxToolCalls } = ConfigSchema.parse(config ?? {});
 *   // Use maxToolCalls...
 * });
 * ```
 */
export function defineCodeGrader(handler: CodeGraderHandler): void {
  // Run immediately when module is loaded
  runCodeGrader(handler);
}

/**
 * Define a prompt template with automatic stdin/stdout handling.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed input
 * 4. Outputs the generated prompt string to stdout
 * 5. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that generates the prompt string from input
 *
 * @example
 * ```typescript
 * import { definePromptTemplate } from '@agentv/sdk';
 *
 * export default definePromptTemplate((ctx) => {
 *   const question = ctx.input
 *     .filter((message) => message.role === 'user')
 *     .map((message) => typeof message.content === 'string' ? message.content : '')
 *     .join('\n');
 *   const answer = ctx.output ?? '';
 *   return `Question: ${question}\nAnswer: ${answer}`;
 * });
 * ```
 */
export function definePromptTemplate(handler: PromptTemplateHandler): void {
  // Run immediately when module is loaded
  runPromptTemplate(handler);
}

/**
 * Define a custom assertion grader with automatic stdin/stdout handling.
 *
 * Assertions are the simplest way to add custom evaluation logic. They receive
 * the full evaluation context and return a pass/fail result with optional
 * granular scoring.
 *
 * This function:
 * 1. Reads JSON from stdin (snake_case format)
 * 2. Converts to camelCase and validates with Zod
 * 3. Calls your handler with typed context
 * 4. Normalizes the result (pass→score, clamp, etc.)
 * 5. Outputs JSON to stdout
 * 6. Handles errors gracefully with proper exit codes
 *
 * @param handler - Function that evaluates the context and returns a result
 *
 * @example Simple pass/fail
 * ```typescript
 * import { defineAssertion } from '@agentv/sdk';
 *
 * export default defineAssertion(({ output }) => {
 *   const text = output ?? '';
 *   return {
 *     pass: text.toLowerCase().includes('hello'),
 *     assertions: [{ text: 'Checks for greeting', passed: text.toLowerCase().includes('hello') }],
 *   };
 * }));
 * ```
 *
 * @example Granular scoring
 * ```typescript
 * import { defineAssertion } from '@agentv/sdk';
 *
 * export default defineAssertion(({ output, traceSummary }) => {
 *   const text = output ?? '';
 *   const hasContent = text.length > 0 ? 0.5 : 0;
 *   const isEfficient = (traceSummary?.eventCount ?? 0) <= 5 ? 0.5 : 0;
 *   return {
 *     score: hasContent + isEfficient,
 *     assertions: [
 *       { text: 'Has content', passed: !!hasContent },
 *       { text: 'Efficient', passed: !!isEfficient },
 *     ],
 *   };
 * }));
 * ```
 */
export function defineAssertion(handler: AssertionHandler): void {
  runAssertion(handler);
}
