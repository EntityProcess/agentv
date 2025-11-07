import { describe, expect, it } from "vitest";

import { createAgentKernel } from "../src/index.js";

describe("createAgentKernel", () => {
  it("returns the stub status", () => {
    expect(createAgentKernel()).toEqual({ status: "stub" });
  });
});
