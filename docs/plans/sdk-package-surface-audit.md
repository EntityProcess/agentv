# SDK Package Surface Audit

Date: 2026-07-07
Bead: `av-97sv`

## Recommendation

`@agentv/sdk` should not remain a separate canonical authoring package. Public TypeScript authoring and programmatic APIs belong on the main `agentv` package facade, following Promptfoo's single obvious public package pattern where practical.

Do not fold the SDK surface directly into `@agentv/core` as the primary user-facing import. `@agentv/core` should stay the engine and contract workspace layer; adding executable grader wrappers, prompt template wrappers, workspace helper ergonomics, and facade docs there would make the core/package boundary less honest. Because there are no production users to preserve, prefer a breaking cleanup now: make `@agentv/core` private unless a specific lower-level contract needs to stay public, and expose that contract through the `agentv` facade or explicit `agentv/*` subpaths.

The settled target shape is:

- `agentv`: default install and user-facing facade for CLI plus Node/TypeScript APIs such as `evaluate`, `defineScriptGrader`, `defineAssertion`, `definePromptTemplate`, `defineEval`, `graders`, and typed config helpers.
- private internal `@agentv/core` workspace package: lower-level runtime, evaluation engine, schemas/contracts, provider interfaces, artifact readers/writers, and implementation APIs used by CLI, Dashboard, and tests.
- no canonical public `@agentv/sdk` authoring package. At most, keep it as temporary compatibility re-exports during migration; first-party docs/examples/scaffolds should import from `agentv`.

After operator clarification on 2026-07-07, this is no longer an open decision. Branch `av-97sv-sdk-surface` implements the package-surface direction in commits `5e7d733d` and `f7e4b7b3`; this report records the rationale and remaining cleanup.

## Promptfoo Comparison

Promptfoo currently publishes one primary package, `promptfoo`, that is both CLI and Node API facade. Its `package.json` exposes the root package as `dist/src/index.js`, exposes CLI binaries `promptfoo` and `pf`, and has only one explicit subpath export, `./contracts` (`/home/entity/projects/promptfoo/promptfoo@origin/main:package.json`, commit `786b2bd`, lines 12-28 and 51-54).

Promptfoo's public facade exports `evaluate`, provider loading, assertions, cache, guardrails, redteam, and types from `src/index.ts` rather than from a separate SDK package (`src/index.ts`, lines 1-24 and 63-73). Its Node API docs teach imports from `promptfoo`, not `@promptfoo/sdk` (`site/docs/usage/node-api-quick-reference.md`, lines 12-39; `site/docs/usage/node-api-reference.md`, lines 27-69).

Promptfoo is also not pretending the single package is architecturally clean. Its architecture docs explicitly say it still publishes one package while modeling future private layers, with `src/index.ts` as the public compatibility facade and `src/contracts` as the first leaf-safe surface (`docs/architecture/packages.md`, lines 1-23 and 39-60). Its multi-package proposal recommends keeping `promptfoo` as the default full install, creating private workspace packages first, and publishing only boundaries that prove useful (`docs/plans/2026-05-02-multi-package-system-proposal.md`, lines 3-23 and 57-65).

Pattern to copy: one obvious default package/facade, narrow leaf contracts, private boundaries before public promises, and helper names that match the product's ergonomic vocabulary. AgentV should preserve `defineAssertion()` and `defineScriptGrader()` while aligning surrounding import/package shape with Promptfoo.

Pattern to avoid: importing through the public facade from internal modules. Promptfoo explicitly bans internal imports of `src/index.ts` because that hides cycles and makes package extraction harder (`docs/architecture/packages.md`, lines 25-37).

Important interpretation: Promptfoo's single published package is not a reason to collapse AgentV core, Dashboard, and CLI source into one internal package. It is evidence for a single obvious user-facing install/facade. Promptfoo's own docs point the other way internally: keep a facade while modeling private `contracts`, `core`, `node`, `cli`, and `app` layers. For AgentV, that means the Dashboard can remain a private workspace app bundled into the `agentv` npm tarball, while `@agentv/core` remains the shared non-CLI layer used by the CLI server, Dashboard client read models, and lower-level integrations.

## AgentV Findings

AgentV currently has three published package surfaces: `agentv`, `@agentv/core`, and `@agentv/sdk` (`.agents/publish.md`, lines 26-30). The CLI package is described as the CLI entry point and has only a `bin` entry today, while SDK docs make `@agentv/sdk` the user-facing package for `evaluate`, typed eval authoring, custom assertions, script graders, prompt templates, target-client helpers, and Zod (`apps/cli/package.json`, lines 14-17; `packages/sdk/README.md`, lines 1-4 and 269-287).

That makes `@agentv/sdk` broader than a small grader helper package. Its root export re-exports core `evaluate`, defines eval authoring helpers, grader config factories, target-client helpers, workspace/Vitest helpers, prompt template and assertion wrappers, Zod schemas, and many trace/content types (`packages/sdk/src/index.ts`, lines 66-248 and 268-410). Public docs reinforce the split by telling users to install `@agentv/sdk` for authoring and `@agentv/core` for config (`apps/web/src/content/docs/docs/next/evaluation/sdk.mdx`, lines 9-24 and 432-450).

`@agentv/core` is not just an SDK dependency. The Dashboard depends on it today. The dashboard app declares `@agentv/core` as a workspace dependency (`apps/dashboard/package.json`, lines 12-19), imports core trace/session read-model functions and types in the browser bundle (`apps/dashboard/src/lib/trace-read-model.ts`, lines 1-10; `apps/dashboard/src/lib/types.ts`, lines 1-14), and the Dashboard Hono server inside the CLI imports core for run/result/project/trace operations (`apps/cli/src/commands/results/serve.ts`, lines 51-73). That is a strong reason to keep a non-CLI core workspace layer. It is not a reason to publish `@agentv/core` publicly, and the current branch marks `@agentv/core` private while exposing deliberate user-facing contracts through `agentv/*` subpaths.

The split is also leaky:

- The CLI imports SDK runtime helpers for the built-in `agentv eval vitest` adapter (`apps/cli/src/commands/eval/commands/vitest.ts`, lines 1-4 and 44-62). That makes CLI command code depend on the public SDK facade.
- Core knows about SDK branding symbols when loading TypeScript eval files (`packages/core/src/evaluation/loaders/ts-eval-loader.ts`, lines 18-19 and 110-116). That is a hidden package contract.
- SDK duplicates TypeScript eval lowering keys that core also owns (`packages/sdk/src/eval.ts`, lines 3-45 and 280-320; `packages/core/src/evaluation/loaders/ts-eval-loader.ts`, lines 18-53).
- SDK `AssertionType` duplicates core grader kind vocabulary and carries compatibility/deprecation entries separately from `GRADER_KIND_VALUES` (`packages/sdk/src/assertion.ts`, lines 38-74; `packages/core/src/evaluation/types.ts`, lines 179-216).
- SDK grader helper types duplicate a subset of core `GraderConfig` shapes, but with camelCase authoring names that lower to snake_case later (`packages/sdk/src/graders.ts`, lines 14-138 and 140-269; `packages/core/src/evaluation/types.ts`, lines 415-498 and 693-988).
- SDK trace/message schemas partly parallel core trace/content contracts (`packages/sdk/src/schemas.ts`, lines 28-47 and 248-360; `packages/core/src/evaluation/types.ts`, lines 1-21).
- `createTargetClient()` keeps target vocabulary in the SDK despite the product boundary moving to provider terminology; the file itself documents that it is historical runtime vocabulary, not eval authoring syntax (`packages/sdk/src/target-client.ts`, lines 1-13 and 101-162).

There is real build and maintenance cost. Before the branch cleanup, the root build ran core, SDK, dashboard, and CLI; SDK built core first; CLI built SDK first, which built core again (`package.json`, lines 8-17; `packages/sdk/package.json`, lines 23-32; `apps/cli/package.json`, lines 18-28). A lightweight Bun inspection showed SDK contained 11 source files and about 94 KB of TypeScript source, with 3 runtime dependencies, while `@agentv/core` and `agentv` each carried their own dependency/optional dependency surfaces. The current branch removes the recursive package-local build chain and publishes only the `agentv` package.

## Rationale

Folding the public helpers into `agentv` matches the installed product name and the Promptfoo precedent: users install one package for the CLI and can import the same package for programmatic usage. This also lets docs say "install `agentv`" instead of choosing among `agentv`, `@agentv/sdk`, and `@agentv/core`.

Keeping implementation in lower layers still matters. The `agentv` facade should not become the internal import path. Internals should import direct core/adapter modules, and the facade should only re-export stable user-facing APIs. This preserves the Promptfoo lesson: public facade outside, private layers inside.

Folding directly into the core layer would reduce package count but worsens the core boundary. SDK helpers are mostly executable authoring ergonomics: stdin/stdout wrappers, assertion/script runtime wrappers, Vitest adapter wrapping, prompt template execution, workspace convenience APIs, and Zod re-exports. Those are not pure core primitives.

Publishing `@agentv/core` as a broad public package is also questionable. The current root barrel exposes many implementation-heavy modules and even a stub `createAgentKernel()` (`packages/core/src/index.ts`, lines 1-268). A Promptfoo-aligned package strategy would make `agentv` the public facade, keep core as a private workspace layer, and expose only deliberate lower-level contracts through stable facade subpaths such as `agentv/contracts`, `agentv/provider`, or `agentv/core` if those names are accepted.

Keeping `@agentv/sdk` forever is also not ideal. It forces users to learn a second first-party package, creates a CLI -> SDK -> core chain for CLI-owned behavior, and encourages a parallel type/schema layer that must stay in sync with core.

## Risks and Migration Notes

- Install weight: importing helpers from `agentv` means a local project dependency on the CLI package. This mirrors Promptfoo, but it may be heavier than the current SDK package for users who only want script helper imports. Mitigation: provide leaf subpath exports, e.g. `agentv/sdk` and possibly `agentv/contracts`, that do not import CLI command modules.
- Compatibility: the operator confirmed there are no production users, so this should be a breaking change. First-party docs/examples/scaffolds should move directly to the new `agentv` surface instead of carrying long-lived `@agentv/sdk` or `@agentv/core` aliases.
- Internal cycles: do not let core or CLI internals import from `agentv` facade. Add a package graph test similar to the existing core/sdk package graph test (`packages/sdk/test/package-graph.test.ts`, lines 29-62).
- Type ownership: choose a single source for eval authoring keys, grader kind values, trace/message schemas, and boundary Zod contracts before changing imports.
- Docs cleanup: README still shows stale `target` authoring in a TypeScript SDK example even though current guidance rejects target/targets in favor of providers (`README.md`, lines 245-253; promptfoo parity docs, lines 68-69 and 87).

## Simplification Opportunities

### Reuse

- Replace SDK-local eval key lowering with a shared core contract/lowering utility. Today SDK and core both carry known camelCase-to-snake_case maps.
- Derive SDK `AssertionType` from core grader kind values, or export a shared assertion-kind contract, rather than maintaining a second string union.
- Reuse core grader config contracts for TypeScript helper return types where possible; keep camelCase authoring options as thin helper input types only.
- Move the Vitest adapter implementation to CLI/core internal code and let SDK expose only a wrapper if needed. The CLI should not import the public SDK facade for its own command implementation.
- Create a small contracts subpath for trace/message/script-grader schemas if multiple packages need them, matching Promptfoo's `./contracts` pattern.

### Quality

- Make `agentv` the documented primary programmatic facade, and make `@agentv/core` explicitly lower-level. This removes the current docs split where `evaluate()` is owned by core but taught through SDK.
- Keep `@agentv/core` private unless a specific lower-level contract earns a public subpath. Expose such contracts through `agentv/*` subpaths rather than broadening the root facade.
- Rename or isolate `createTargetClient()` vocabulary. The public helper should not keep legacy target wording while provider terminology is canonical.
- Reduce root `@agentv/core` barrel sprawl. `packages/core/src/index.ts` exports implementation-heavy artifact, registry, provider, project, and runtime helpers from one root barrel, plus a stub `createAgentKernel()` (lines 1-268). Prefer explicit subpath exports for non-facade internals.
- Remove stale package migration framing from durable docs once the new package decision lands. Current SDK docs still foreground `@agentv/eval` migration history (`packages/sdk/README.md`, lines 11-24; SDK docs, lines 26-39).

### Efficiency

- Fix recursive build scripts so root/CLI builds do not rebuild core multiple times through SDK. Let the root build orchestrate package order, and keep package-local builds package-local where possible.
- If `agentv` gains SDK exports, make those subpath exports leaf-safe so importing `defineScriptGrader` does not load command registration, update checks, dashboard server code, or optional provider SDKs.
- Consolidate example package dependencies after the package decision. At least 16 example package manifests depend on `@agentv/sdk`, some also depend on `@agentv/core`, and 11 example lockfiles exist. One documented local dependency pattern would reduce churn.
- Avoid schema/type generation duplication by deciding whether script-grader schemas live in the contracts layer or are generated from core boundary schemas.

## Follow-Up Work

Follow-up Beads created or updated:

1. `av-qxxr`: expose the `agentv` authoring facade and make `@agentv/sdk` compatibility-only/private, not canonical.
2. `av-b6u5`: make `@agentv/core` private and expose only deliberate lower-level contracts through `agentv/*` subpaths.
3. `av-3c0o`: remove the CLI's dependency on `@agentv/sdk` for `agentv eval vitest` and simplify recursive build scripts.
4. `av-zi7k`: update public docs, examples, scaffolds, and package READMEs to teach `agentv` imports and provider terminology.
5. `av-krn3`: consolidate SDK/core eval authoring, grader kind, and script-grader schema contracts behind a single source of truth.

## Validation

Initial audit validation was research-only: `git fetch origin`, `git status --short --branch`, local file reads, DeepWiki orientation for `promptfoo/promptfoo`, `git -C /home/entity/projects/promptfoo/promptfoo fetch origin`, `git show origin/main:<path>` for Promptfoo evidence, and one `bun -e` manifest/source-size inspection.

Implementation validation on branch `av-97sv-sdk-surface`: `git diff --check`; `bun --filter @agentv/core typecheck`; `bun --filter @agentv/sdk typecheck`; `bun --filter agentv typecheck`; `bun --filter agentv build`; `bun run build`; focused Bun tests for TypeScript eval loader, SDK package graph/evaluate/Vitest, CLI package exports/create assertion/eval Vitest; and Biome checks on changed TypeScript/docs-support files.

Known validation gap: `bun run validate:examples` fails on unchanged pre-existing `examples/showcase/multi-model-benchmark/evals/benchmark.eval.yaml` object-shaped `evaluate_options.repeat`; `origin/main` has the same issue. No live eval dogfood was run because the branch changes package/import/docs plumbing rather than eval execution or grader behavior.
