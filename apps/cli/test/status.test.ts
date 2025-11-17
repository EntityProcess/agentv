import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/index.js";

describe("status command", () => {
  it("prints the stub kernel status", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["node", "agentv", "status"]);

    expect(logSpy).toHaveBeenCalledWith("Kernel status: stub");

    logSpy.mockRestore();
  });
});
