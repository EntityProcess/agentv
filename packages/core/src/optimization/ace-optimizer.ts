import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AxACEBullet,
  AxACEPlaybook,
} from "@ax-llm/ax";

import { runEvaluation, type RunEvaluationOptions } from "../evaluation/orchestrator.js";
import type { EvaluationResult } from "../evaluation/types.js";
import type { EnvLookup, TargetDefinition } from "../evaluation/providers/types.js";
import type { ResolvedTarget } from "../evaluation/providers/targets.js";
import type { ResolvedOptimizerConfig } from "./config.js";
import type { OptimizationResult, Optimizer } from "./types.js";

type EvaluationRunner = (options: RunEvaluationOptions) => Promise<readonly EvaluationResult[]>;

interface AceOptimizerOptions {
  readonly config: ResolvedOptimizerConfig;
  readonly repoRoot: URL | string;
  readonly target: ResolvedTarget;
  readonly targets?: readonly TargetDefinition[];
  readonly env?: EnvLookup;
  readonly evaluationRunner?: EvaluationRunner;
  readonly now?: () => Date;
  readonly logger?: (message: string) => void;
  readonly verbose?: boolean;
}

const DEFAULT_SECTION_NAME = "Core Principles";

export class AceOptimizer implements Optimizer {
  private readonly runEval: EvaluationRunner;
  private readonly now: () => Date;
  private readonly logger: (message: string) => void;

  constructor(private readonly options: AceOptimizerOptions) {
    this.runEval = options.evaluationRunner ?? runEvaluation;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? (() => undefined);
  }

  async optimize(): Promise<OptimizationResult> {
    const { config } = this.options;
    let playbook = await this.loadPlaybook(config.playbookPath, config.description);
    const scores: number[] = [];

    for (let epoch = 0; epoch < config.maxEpochs; epoch += 1) {
      this.logger(
        `ACE epoch ${epoch + 1}/${config.maxEpochs}: running ${config.evalFiles.length} eval file(s)...`,
      );
      const results = await this.runEpoch(config.evalFiles);
      const aggregateScore = this.computeAggregateScore(results);
      scores.push(aggregateScore);

      playbook = this.applyEpochUpdate({
        playbook,
        results,
        aggregateScore,
        epoch,
        allowDynamicSections: config.allowDynamicSections,
      });
      await this.savePlaybook(config.playbookPath, playbook);

      this.logger(
        `ACE epoch ${epoch + 1} complete. score=${aggregateScore.toFixed(
          3,
        )} bullets=${playbook.stats.bulletCount}`,
      );
    }

    return {
      playbookPath: config.playbookPath,
      playbook,
      scores,
      epochsCompleted: scores.length,
    };
  }

  private async runEpoch(evalFiles: readonly string[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    for (const evalFile of evalFiles) {
      const runOptions: RunEvaluationOptions = {
        testFilePath: evalFile,
        repoRoot: this.options.repoRoot,
        target: this.options.target,
        targets: this.options.targets,
        env: this.options.env,
        verbose: this.options.verbose,
      };
      const evalResults = await this.runEval(runOptions);
      results.push(...evalResults);
    }
    return results;
  }

  private computeAggregateScore(results: readonly EvaluationResult[]): number {
    const numericScores = results
      .map((result) => result.score)
      .filter((value) => typeof value === "number" && Number.isFinite(value));

    if (numericScores.length === 0) {
      return 0;
    }

    const total = numericScores.reduce((sum, value) => sum + value, 0);
    const average = total / numericScores.length;
    return Math.min(1, Math.max(0, average));
  }

  private async loadPlaybook(playbookPath: string, description?: string): Promise<AxACEPlaybook> {
    try {
      await access(playbookPath, constants.F_OK);
    } catch {
      return this.createEmptyPlaybook(description);
    }

    try {
      const raw = await readFile(playbookPath, "utf8");
      const parsed = JSON.parse(raw) as AxACEPlaybook;
      return this.normalizePlaybook(parsed, description);
    } catch (error) {
      throw new Error(`Failed to read playbook at ${playbookPath}: ${(error as Error).message}`);
    }
  }

  private createEmptyPlaybook(description?: string): AxACEPlaybook {
    const timestamp = this.now().toISOString();
    return {
      version: 1,
      sections: {},
      stats: { bulletCount: 0, helpfulCount: 0, harmfulCount: 0, tokenEstimate: 0 },
      updatedAt: timestamp,
      ...(description ? { description } : {}),
    };
  }

  private normalizePlaybook(playbook: AxACEPlaybook, description?: string): AxACEPlaybook {
    const timestamp = this.now().toISOString();
    const sections = playbook.sections ?? {};
    const normalizedSections: Record<string, AxACEBullet[]> = {};
    for (const [sectionName, bullets] of Object.entries(sections)) {
      normalizedSections[sectionName] = Array.isArray(bullets) ? bullets : [];
    }

    const stats = this.recomputeStats(normalizedSections);
    return {
      version: typeof playbook.version === "number" ? playbook.version : 1,
      sections: normalizedSections,
      stats,
      updatedAt: playbook.updatedAt ?? timestamp,
      description: playbook.description ?? description,
    };
  }

  private recomputeStats(sections: Record<string, AxACEBullet[]>): AxACEPlaybook["stats"] {
    let bulletCount = 0;
    let helpfulCount = 0;
    let harmfulCount = 0;
    let totalTextLength = 0;

    for (const bullets of Object.values(sections)) {
      bulletCount += bullets.length;
      for (const bullet of bullets) {
        helpfulCount += bullet.helpfulCount ?? 0;
        harmfulCount += bullet.harmfulCount ?? 0;
        totalTextLength += bullet.content?.length ?? 0;
      }
    }

    const tokenEstimate = totalTextLength > 0 ? Math.max(1, Math.round(totalTextLength / 4)) : 0;

    return { bulletCount, helpfulCount, harmfulCount, tokenEstimate };
  }

  private async savePlaybook(playbookPath: string, playbook: AxACEPlaybook): Promise<void> {
    const directory = path.dirname(playbookPath);
    await mkdir(directory, { recursive: true });
    const payload = JSON.stringify(playbook, null, 2);
    await writeFile(playbookPath, payload, "utf8");
  }

  private applyEpochUpdate(options: {
    readonly playbook: AxACEPlaybook;
    readonly results: readonly EvaluationResult[];
    readonly aggregateScore: number;
    readonly epoch: number;
    readonly allowDynamicSections: boolean;
  }): AxACEPlaybook {
    const { playbook, results, aggregateScore, epoch, allowDynamicSections } = options;
    const timestamp = this.now().toISOString();
    const sectionName = this.pickSection(playbook, allowDynamicSections);

    const bullet: AxACEBullet = {
      id: this.createBulletId(sectionName),
      section: sectionName,
      content: this.buildBulletContent(results, aggregateScore),
      helpfulCount: 0,
      harmfulCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      tags: this.buildTags(aggregateScore, epoch),
      metadata: {
        aggregateScore,
        epoch,
        evalIds: results.map((result) => result.eval_id),
      },
    };

    const sections = { ...playbook.sections };
    const currentBullets = sections[sectionName] ? [...sections[sectionName]!] : [];
    currentBullets.push(bullet);
    sections[sectionName] = currentBullets;

    const stats = this.recomputeStats(sections);
    return {
      ...playbook,
      sections,
      stats,
      updatedAt: timestamp,
    };
  }

  private pickSection(playbook: AxACEPlaybook, allowDynamic: boolean): string {
    const existingSections = Object.keys(playbook.sections ?? {});
    if (existingSections.length > 0) {
      return existingSections.includes(DEFAULT_SECTION_NAME)
        ? DEFAULT_SECTION_NAME
        : existingSections[0];
    }

    if (allowDynamic) {
      return "Optimization Insights";
    }

    return DEFAULT_SECTION_NAME;
  }

  private createBulletId(sectionName: string): string {
    const normalized = sectionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const prefix = normalized.slice(0, 8) || "section";
    const random = randomUUID().replace(/-/g, "").slice(0, 8);
    return `${prefix}-${random}`;
  }

  private buildBulletContent(
    results: readonly EvaluationResult[],
    aggregateScore: number,
  ): string {
    if (results.length === 0) {
      return "No evaluation results were produced in this epoch.";
    }

    const sorted = [...results].sort((a, b) => a.score - b.score);
    const worst = sorted.slice(0, Math.min(sorted.length, 3));
    const misses = results
      .flatMap((result) => result.misses ?? [])
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 5);
    const reasoningSample = results.find((result) => typeof result.reasoning === "string")
      ?.reasoning;

    const parts = [
      `Average score ${aggregateScore.toFixed(3)} across ${results.length} evals.`,
      worst.length > 0
        ? `Lowest cases: ${worst.map((result) => `${result.eval_id}=${result.score.toFixed(2)}`).join(", ")}.`
        : undefined,
      misses.length > 0 ? `Focus misses: ${misses.join(", ")}.` : undefined,
      reasoningSample ? `Sample reasoning: ${reasoningSample}` : undefined,
    ].filter(Boolean) as string[];

    return parts.join(" ");
  }

  private buildTags(aggregateScore: number, epoch: number): string[] {
    const tags = [`epoch-${epoch + 1}`, "ace"];
    if (aggregateScore >= 0.8) {
      tags.push("high-score");
    } else if (aggregateScore < 0.5) {
      tags.push("needs-work");
    }
    return tags;
  }
}
