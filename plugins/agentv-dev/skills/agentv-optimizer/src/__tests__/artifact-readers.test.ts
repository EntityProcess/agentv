import { describe, expect, it } from "vitest";
import { readBenchmarkSummary } from "../artifact-readers";

describe("artifact readers", () => {
  it("reads aggregate benchmark data from AgentV artifacts", () => {
    expect(Object.keys(readBenchmarkSummary("src/__fixtures__/benchmark.json").targets).length).toBeGreaterThan(0);
  });
});
