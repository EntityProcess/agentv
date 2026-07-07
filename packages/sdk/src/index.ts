/**
 * AgentV Evaluation SDK
 *
 * Build custom assertions, script graders, and eval authoring helpers for AI agent outputs.
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
 *     score: answer.includes('hello') ? 1 : 0,
 *     reason: answer.includes('hello') ? 'Greeting found' : 'Greeting missing',
 *   };
 * }));
 * ```
 *
 * @example script grader (full control)
 * ```typescript
 * #!/usr/bin/env bun
 * import { defineScriptGrader } from '@agentv/sdk';
 *
 * export default defineScriptGrader(({ output, traceSummary }) => {
 *   return {
 *     score: (output ?? '').length > 0 && (traceSummary?.eventCount ?? 0) <= 5 ? 1.0 : 0.5,
 *     pass: (output ?? '').length > 0 && (traceSummary?.eventCount ?? 0) <= 5,
 *     reason: 'Checks answer text and trace size',
 *     checks: [
 *       { text: 'Answer is not empty', pass: (output ?? '').length > 0, reason: 'Output text is present' },
 *       { text: 'Efficient tool usage', pass: (traceSummary?.eventCount ?? 0) <= 5, reason: 'Trace event count is within limit' },
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
  ScriptGraderInputSchema,
  ScriptGraderCheckSchema,
  ScriptGraderResultSchema,
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
  type ScriptGraderInput,
  type ScriptGraderCheck,
  type ScriptGraderResult,
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
  type EvalRunArtifacts,
  type EvalRunResult,
  type EvalSummary,
  type EvalTestInput,
} from '@agentv/core';

export {
  defineEval,
  serializeEvalYaml,
  toEvalYamlObject,
  type DefinedEvalSuite,
  type EvalAssertionConfig,
  type EvalConfig,
  type EvalDockerEnvironment,
  type EvalDockerEnvironmentMount,
  type EvalDockerEnvironmentResources,
  type EvalDefaultTest,
  type EvalEnvironment,
  type EvalEnvironmentSetup,
  type EvalExecution,
  type EvalHostEnvironment,
  type EvalLifecycleHook,
  type EvalLifecycleHooks,
  type EvalMessage,
  type EvalMessageContent,
  type EvalProviderConfig,
  type EvalProviderEntry,
  type EvalProviderMap,
  type EvalProviderRef,
  type EvalRepeat,
  type EvalRequires,
  type EvalTest,
  type EvalTestOptions,
  type EvalTurn,
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
  llmRubricGrader,
  regexGrader,
  scriptGrader,
  type ScriptGraderConfig,
  type ScriptGraderOptions,
  type ScriptGraderProviderOptions,
  type ScriptGraderTargetOptions,
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
  type LlmRubricGraderConfig,
  type RegexGraderConfig,
  type RegexGraderOptions,
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
  type WorkspaceCheck,
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
  vitestReportToScriptGraderResult,
  vitestReportToCodeGraderResult,
  type VitestWorkspaceGraderOptions,
} from './vitest.js';

// Re-export Zod for typed config support
export { z } from 'zod';

// Re-export assertion types
export type {
  AssertionCheck,
  AssertionContext,
  AssertionHandler,
  AssertionScore,
  AssertionType,
} from './assertion.js';

import { type AssertionHandler, runAssertion } from './assertion.js';
import { type PromptTemplateHandler, runPromptTemplate } from './prompt-template.js';
import {
  type CodeGraderHandler,
  type ScriptGraderHandler,
  runCodeGrader,
  runScriptGrader,
} from './runtime.js';

export { runCodeGrader, runScriptGrader };
export type { CodeGraderHandler, ScriptGraderHandler };
export type { PromptTemplateHandler };

/**
 * Define a script grader with automatic stdin/stdout handling.
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
 * import { defineScriptGrader } from '@agentv/sdk';
 *
 * export default defineScriptGrader(({ trace }) => {
 *   if (!trace) {
 *     return { pass: false, score: 0.5, reason: 'No trace available' };
 *   }
 *
 *   const efficient = trace.eventCount <= 10;
 *   return {
 *     pass: efficient,
 *     score: efficient ? 1.0 : 0.5,
 *     reason: efficient ? 'Efficient execution' : 'Too many tool calls',
 *     checks: [{ text: 'Trace event count within limit', pass: efficient, reason: `${trace.eventCount} events observed` }],
 *   };
 * });
 * ```
 *
 * @example With typed config
 * ```typescript
 * import { defineScriptGrader, z } from '@agentv/sdk';
 *
 * const ConfigSchema = z.object({
 *   maxToolCalls: z.number().default(10),
 * });
 *
 * export default defineScriptGrader(({ trace, config }) => {
 *   const { maxToolCalls } = ConfigSchema.parse(config ?? {});
 *   // Use maxToolCalls...
 * });
 * ```
 */
export function defineScriptGrader(handler: ScriptGraderHandler): void {
  // Run immediately when module is loaded
  runScriptGrader(handler);
}

/** @deprecated Use defineScriptGrader. */
export function defineCodeGrader(handler: ScriptGraderHandler): void {
  defineScriptGrader(handler);
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
 * Define a custom assertion with automatic stdin/stdout handling.
 *
 * Assertions are the simplest way to add reusable custom checks. They receive
 * the full evaluation context and return a pass/fail result with optional
 * granular scoring. Place these files in `.agentv/assertions/` and reference
 * them by discovered assertion type name. Use defineScriptGrader for
 * command-backed graders referenced with `type: script`.
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
 *     reason: text.toLowerCase().includes('hello') ? 'Greeting found' : 'Greeting missing',
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
 *     reason: 'Checks content exists and trace size',
 *     checks: [
 *       { text: 'Has content', pass: !!hasContent, reason: hasContent ? 'Output is non-empty' : 'Output is empty' },
 *       { text: 'Efficient', pass: !!isEfficient, reason: isEfficient ? 'Trace is within limit' : 'Trace exceeds limit' },
 *     ],
 *   };
 * }));
 * ```
 */
export function defineAssertion(handler: AssertionHandler): void {
  runAssertion(handler);
}
