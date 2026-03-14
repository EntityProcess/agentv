import { describe, expect, it } from "vitest";
import { aggregateBenchmarks } from "../aggregate-benchmark";

describe("aggregate benchmark", () => {
  it("aggregates pass-rate and timing metrics from benchmark artifacts", () => {
    const summary = aggregateBenchmarks({
      benchmarkPath: "src/__fixtures__/benchmark.json",
      timingPath: "src/__fixtures__/timing.json",
      resultsPath: "src/__fixtures__/results.jsonl",
    });
    expect(Object.keys(summary.targets).length).toBeGreaterThan(0);
  });
});
