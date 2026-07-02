import { type Stats, existsSync } from 'node:fs';
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  AgentRulesExtensionConfig,
  AgentRulesPaths,
  AgentVExtensionConfig,
  EvalTest,
  ExtensionLifecycleHook,
  JsonObject,
} from '../types.js';

export interface ExtensionHookContext {
  readonly hook_name: ExtensionLifecycleHook;
  readonly workspace_path?: string;
  readonly test_id: string;
  readonly eval_run_id?: string;
  readonly eval_dir: string;
  readonly case_input?: string;
  readonly case_metadata?: Record<string, unknown>;
  readonly workspace_file_dir?: string;
  readonly provider_context?: JsonObject;
  readonly agent_rules_paths?: AgentRulesPaths;
}

export interface ExtensionRuntimeState {
  readonly providerContext?: JsonObject;
  readonly metadata?: Record<string, unknown>;
  readonly output?: string;
  readonly agentRulesPaths?: AgentRulesPaths;
}

type ExtensionReturn = {
  readonly provider_context?: JsonObject;
  readonly metadata?: Record<string, unknown>;
  readonly output?: string;
  readonly agent_rules_paths?: AgentRulesPaths;
};

export function mergeExtensionState(
  left: ExtensionRuntimeState | undefined,
  right: ExtensionRuntimeState | undefined,
): ExtensionRuntimeState | undefined {
  if (!left) return right;
  if (!right) return left;

  const agentRulesPaths = mergeAgentRulesPaths(left.agentRulesPaths, right.agentRulesPaths);
  const providerContext = {
    ...(left.providerContext ?? {}),
    ...(right.providerContext ?? {}),
    ...(agentRulesPaths ? { agent_rules_paths: agentRulesPaths } : {}),
  };
  const metadata = {
    ...(left.metadata ?? {}),
    ...(right.metadata ?? {}),
    ...(agentRulesPaths ? { agent_rules_paths: agentRulesPaths } : {}),
  };
  const output = [left.output, right.output].filter(Boolean).join('\n') || undefined;

  return {
    ...(Object.keys(providerContext).length > 0 ? { providerContext } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(agentRulesPaths !== undefined ? { agentRulesPaths } : {}),
  };
}

export async function runExtensionsForHook(options: {
  readonly extensions: readonly AgentVExtensionConfig[] | undefined;
  readonly hook: ExtensionLifecycleHook;
  readonly context: ExtensionHookContext;
  readonly state?: ExtensionRuntimeState;
}): Promise<ExtensionRuntimeState | undefined> {
  const matching = (options.extensions ?? []).filter(
    (extension) => extension.hook === options.hook,
  );
  if (matching.length === 0) {
    return options.state;
  }

  let state = options.state;
  for (const extension of matching) {
    const context = buildContextWithState(options.context, state);
    const next = isAgentRulesExtension(extension)
      ? await runAgentRulesExtension(extension, context)
      : await runFileExtension(extension, context);
    state = mergeExtensionState(state, next);
  }
  return state;
}

function buildContextWithState(
  context: ExtensionHookContext,
  state: ExtensionRuntimeState | undefined,
): ExtensionHookContext {
  return {
    ...context,
    ...(state?.providerContext !== undefined ? { provider_context: state.providerContext } : {}),
    ...(state?.agentRulesPaths !== undefined ? { agent_rules_paths: state.agentRulesPaths } : {}),
  };
}

function isAgentRulesExtension(
  extension: AgentVExtensionConfig,
): extension is AgentRulesExtensionConfig {
  return extension.id === 'agentv:agent-rules';
}

async function runFileExtension(
  extension: Exclude<AgentVExtensionConfig, AgentRulesExtensionConfig>,
  context: ExtensionHookContext,
): Promise<ExtensionRuntimeState | undefined> {
  const moduleUrl = pathToFileURL(extension.path);
  moduleUrl.search = `t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const imported = (await import(moduleUrl.href)) as Record<string, unknown>;
  const defaultExport = imported.default;
  const maybeCommonJs =
    defaultExport && typeof defaultExport === 'object'
      ? (defaultExport as Record<string, unknown>)[extension.functionName]
      : undefined;
  const hookFn = imported[extension.functionName] ?? maybeCommonJs;
  if (typeof hookFn !== 'function') {
    throw new Error(`Extension ${extension.id} does not export function ${extension.functionName}`);
  }

  const result = (await hookFn(context, { hookName: extension.hook })) as unknown;
  return normalizeExtensionReturn(result);
}

async function runAgentRulesExtension(
  extension: AgentRulesExtensionConfig,
  context: ExtensionHookContext,
): Promise<ExtensionRuntimeState | undefined> {
  if (!context.workspace_path) {
    throw new Error('agentv:agent-rules requires a materialized workspace');
  }

  const paths: AgentRulesPaths = {
    skills: await stageConfiguredOrDiscover({
      kind: 'skills',
      configured: extension.skills,
      evalDir: context.eval_dir,
      workspacePath: context.workspace_path,
      discover: ['.claude/skills', '.agents/skills', '.codex/skills', '.pi/skills', 'skills'],
    }),
    hooks: await stageConfiguredOrDiscover({
      kind: 'hooks',
      configured: extension.hooks,
      evalDir: context.eval_dir,
      workspacePath: context.workspace_path,
      discover: ['.claude/hooks', '.agents/hooks', '.codex/hooks', '.pi/hooks', 'hooks'],
    }),
    agents: await stageConfiguredOrDiscover({
      kind: 'agents',
      configured: extension.agents,
      evalDir: context.eval_dir,
      workspacePath: context.workspace_path,
      discover: ['.agents/agents', '.codex/agents', 'agents'],
    }),
    rules: await stageConfiguredOrDiscover({
      kind: 'rules',
      configured: extension.rules,
      evalDir: context.eval_dir,
      workspacePath: context.workspace_path,
      discover: ['AGENTS.md', 'CLAUDE.md', 'rules'],
    }),
  };
  const compactPaths = compactAgentRulesPaths(paths);
  if (!compactPaths) {
    return undefined;
  }

  return normalizeExtensionReturn({
    provider_context: { agent_rules_paths: compactPaths },
    metadata: { agent_rules_paths: compactPaths },
    agent_rules_paths: compactPaths,
  });
}

async function stageConfiguredOrDiscover(options: {
  readonly kind: keyof AgentRulesPaths;
  readonly configured: readonly string[] | undefined;
  readonly evalDir: string;
  readonly workspacePath: string;
  readonly discover: readonly string[];
}): Promise<readonly string[] | undefined> {
  if (!options.configured || options.configured.length === 0) {
    const discovered = options.discover
      .map((candidate) => path.resolve(options.workspacePath, candidate))
      .filter((candidate) => existsSync(candidate));
    return discovered.length > 0 ? discovered : undefined;
  }

  const staged: string[] = [];
  const stageRoot = path.join(options.workspacePath, '.agentv', 'agent-rules', options.kind);
  await mkdir(stageRoot, { recursive: true });

  for (const entry of options.configured) {
    const sourcePath = path.isAbsolute(entry) ? entry : path.resolve(options.evalDir, entry);
    let sourceStat: Stats;
    try {
      sourceStat = await stat(sourcePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`agentv:agent-rules ${options.kind} path not found: ${entry}: ${message}`);
    }

    if (isInside(options.workspacePath, sourcePath)) {
      staged.push(sourcePath);
      continue;
    }

    const destPath = path.join(stageRoot, path.basename(sourcePath));
    await cp(sourcePath, destPath, {
      recursive: sourceStat.isDirectory(),
      force: true,
    });
    staged.push(destPath);
  }

  return staged.length > 0 ? staged : undefined;
}

function normalizeExtensionReturn(value: unknown): ExtensionRuntimeState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result = value as ExtensionReturn;
  const agentRulesPaths = compactAgentRulesPaths(result.agent_rules_paths);
  const providerContext = {
    ...(result.provider_context ?? {}),
    ...(agentRulesPaths ? { agent_rules_paths: agentRulesPaths } : {}),
  };
  const metadata = {
    ...(result.metadata ?? {}),
    ...(agentRulesPaths ? { agent_rules_paths: agentRulesPaths } : {}),
  };

  return {
    ...(Object.keys(providerContext).length > 0 ? { providerContext } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(typeof result.output === 'string' ? { output: result.output } : {}),
    ...(agentRulesPaths ? { agentRulesPaths } : {}),
  };
}

function compactAgentRulesPaths(paths: AgentRulesPaths | undefined): AgentRulesPaths | undefined {
  if (!paths) {
    return undefined;
  }
  const compacted: AgentRulesPaths = {
    ...(paths.skills && paths.skills.length > 0 ? { skills: [...paths.skills] } : {}),
    ...(paths.hooks && paths.hooks.length > 0 ? { hooks: [...paths.hooks] } : {}),
    ...(paths.agents && paths.agents.length > 0 ? { agents: [...paths.agents] } : {}),
    ...(paths.rules && paths.rules.length > 0 ? { rules: [...paths.rules] } : {}),
  };
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function mergeAgentRulesPaths(
  left: AgentRulesPaths | undefined,
  right: AgentRulesPaths | undefined,
): AgentRulesPaths | undefined {
  if (!left) return compactAgentRulesPaths(right);
  if (!right) return compactAgentRulesPaths(left);

  return compactAgentRulesPaths({
    skills: mergePathLists(left.skills, right.skills),
    hooks: mergePathLists(left.hooks, right.hooks),
    agents: mergePathLists(left.agents, right.agents),
    rules: mergePathLists(left.rules, right.rules),
  });
}

function mergePathLists(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
