#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Verdict = 'pass' | 'fail' | 'borderline' | 'skip';

type ScoreRecord = {
  name?: string;
  type?: string;
  score?: number;
  verdict?: Verdict;
  scores?: ScoreRecord[];
  reasoning?: string;
};

type EvalResult = {
  timestamp?: string;
  test_id?: string;
  dataset?: string;
  target?: string;
  input?: string;
  output_text?: string;
  score?: number;
  scores?: ScoreRecord[];
};

type GroundTruth = {
  label: 'pass' | 'fail';
  rationale?: string;
};

function usage(): never {
  console.error(`Usage: bun score-grader-benchmark.ts --results <results.jsonl> --dataset <labeled.jsonl> [--label <name>] [--evaluator <name>]

Reads raw AgentV eval JSONL for a grader panel, resolves a majority verdict from child grader scores,
and emits scored JSONL where score=1 means the panel matched human ground truth.

Options:
  --results <file>     Raw AgentV eval output JSONL
  --dataset <file>     Offline labeled export JSONL used for the eval
  --label <name>       Optional output target label (defaults to input target or results filename)
  --evaluator <name>   Composite evaluator name to inspect (defaults to first composite / first score group)
  --help               Show this help message
`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeLabel(raw: unknown): 'pass' | 'fail' {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['pass', 'approved', 'accept', 'correct', 'true', 'yes'].includes(value)) return 'pass';
  if (['fail', 'rejected', 'reject', 'incorrect', 'false', 'no'].includes(value)) return 'fail';
  throw new Error(`Unsupported ground-truth label: ${String(raw)}`);
}

function normalizeGraderVote(
  verdict: Verdict | undefined,
  score: number | undefined,
): 'pass' | 'fail' {
  if (verdict === 'pass' || verdict === 'borderline') return 'pass';
  if (verdict === 'fail') return 'fail';
  return (score ?? 0) >= 0.5 ? 'pass' : 'fail';
}

function parseGroundTruth(rawExpectedOutput: unknown): GroundTruth {
  let candidate = rawExpectedOutput;

  if (Array.isArray(rawExpectedOutput) && rawExpectedOutput.length > 0) {
    candidate = rawExpectedOutput[rawExpectedOutput.length - 1];
    if (
      candidate &&
      typeof candidate === 'object' &&
      'content' in (candidate as Record<string, unknown>)
    ) {
      candidate = (candidate as Record<string, unknown>).content;
    }
  }

  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      return {
        label: normalizeLabel(parsed.label ?? parsed.verdict),
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
      };
    } catch {
      return { label: normalizeLabel(candidate) };
    }
  }

  if (candidate && typeof candidate === 'object') {
    const parsed = candidate as Record<string, unknown>;
    return {
      label: normalizeLabel(parsed.label ?? parsed.verdict),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
    };
  }

  throw new Error('Expected output must encode a pass/fail label');
}

function loadDataset(datasetPath: string): Map<string, GroundTruth> {
  const map = new Map<string, GroundTruth>();
  const lines = readFileSync(datasetPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const record = JSON.parse(line) as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    if (!id) continue;
    map.set(id, parseGroundTruth(record.expected_output));
  }

  return map;
}

function selectPanel(scores: ScoreRecord[] | undefined, evaluatorName?: string): ScoreRecord {
  if (!scores || scores.length === 0) {
    throw new Error('Result record does not include scores[]');
  }

  if (evaluatorName) {
    const named = scores.find((score) => score.name === evaluatorName);
    if (!named) {
      throw new Error(`Evaluator '${evaluatorName}' not found in scores[]`);
    }
    return named;
  }

  return (
    scores.find((score) => Array.isArray(score.scores) && score.scores.length > 0) ?? {
      name: 'top-level-scores',
      scores,
    }
  );
}

function labelFromPath(filePath: string): string {
  return (
    resolve(filePath)
      .split('/')
      .pop()
      ?.replace(/\.jsonl$/i, '') ?? 'grader-benchmark'
  );
}

const args = process.argv.slice(2);
if (args.includes('--help')) usage();

const resultsPath = getArg('--results');
const datasetPath = getArg('--dataset');
const labelOverride = getArg('--label');
const evaluatorName = getArg('--evaluator');

if (!resultsPath || !datasetPath) usage();

const truthById = loadDataset(datasetPath);
const rawResults = readFileSync(resultsPath, 'utf-8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

let processed = 0;
let correct = 0;
const perGrader = new Map<string, { correct: number; total: number }>();

for (const line of rawResults) {
  const result = JSON.parse(line) as EvalResult;
  if (!result.test_id) continue;

  const truth = truthById.get(result.test_id);
  if (!truth) {
    throw new Error(`No ground truth found for test_id '${result.test_id}' in ${datasetPath}`);
  }

  const panel = selectPanel(result.scores, evaluatorName);
  const graders = panel.scores ?? [];
  if (graders.length === 0) {
    throw new Error(
      `Evaluator '${panel.name ?? 'unknown'}' for '${result.test_id}' has no child grader scores`,
    );
  }

  let passVotes = 0;
  let failVotes = 0;
  let borderlineVotes = 0;
  const graderVotes = graders.map((grader) => {
    const normalizedVote = normalizeGraderVote(grader.verdict, grader.score);
    if (normalizedVote === 'pass') passVotes += 1;
    else failVotes += 1;
    if (grader.verdict === 'borderline') borderlineVotes += 1;

    const graderCorrect = normalizedVote === truth.label;
    const stats = perGrader.get(grader.name ?? 'unnamed') ?? { correct: 0, total: 0 };
    stats.total += 1;
    if (graderCorrect) stats.correct += 1;
    perGrader.set(grader.name ?? 'unnamed', stats);

    return {
      name: grader.name,
      score: grader.score,
      raw_verdict: grader.verdict,
      normalized_vote: normalizedVote,
      correct: graderCorrect,
    };
  });

  const majorityVerdict: 'pass' | 'fail' = passVotes >= failVotes ? 'pass' : 'fail';
  const matched = majorityVerdict === truth.label;
  processed += 1;
  if (matched) correct += 1;

  const output = {
    timestamp: result.timestamp,
    test_id: result.test_id,
    dataset: result.dataset,
    target: labelOverride ?? result.target ?? labelFromPath(resultsPath),
    input: result.input,
    output_text: result.output_text,
    score: matched ? 1 : 0,
    human_label: truth.label,
    human_rationale: truth.rationale,
    majority_label: majorityVerdict,
    evaluator_name: panel.name,
    vote_counts: {
      pass: passVotes,
      fail: failVotes,
      borderline: borderlineVotes,
    },
    grader_votes: graderVotes,
    reasoning: `${panel.name ?? 'grader-panel'} majority=${majorityVerdict} (${passVotes} pass-ish vs ${failVotes} fail) vs human=${truth.label}`,
  };

  console.log(JSON.stringify(output));
}

const summary = {
  processed,
  accuracy: processed === 0 ? 0 : Number((correct / processed).toFixed(4)),
  correct,
  per_grader_accuracy: Object.fromEntries(
    [...perGrader.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, stats]) => [name, Number((stats.correct / stats.total).toFixed(4))]),
  ),
};

console.error(JSON.stringify(summary, null, 2));
