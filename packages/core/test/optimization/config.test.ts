import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadOptimizerConfig, parseOptimizerConfig } from "../../src/optimization/config.js";

describe("optimizer config parsing", () => {
  it("resolves relative paths against the config directory", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agentv-ace-config-"));
    const configPath = path.join(baseDir, "optimizer.yaml");
    const content = `type: ace
eval_files:
  - ./evals/test.yaml
  - ../shared/second.yaml
playbook_path: ./playbooks/notes.json
max_epochs: 2
allow_dynamic_sections: true
`;
    await writeFile(configPath, content, "utf8");

    const config = await loadOptimizerConfig(configPath);
    expect(config.evalFiles).toContain(path.resolve(baseDir, "evals/test.yaml"));
    expect(config.evalFiles).toContain(path.resolve(baseDir, "../shared/second.yaml"));
    expect(config.playbookPath).toBe(path.resolve(baseDir, "playbooks/notes.json"));
    expect(config.maxEpochs).toBe(2);
    expect(config.allowDynamicSections).toBe(true);
  });

  it("rejects non-ACE optimizer types", () => {
    expect(() =>
      parseOptimizerConfig(
        {
          type: "bootstrap",
          eval_files: ["./evals/test.yaml"],
          playbook_path: "./playbook.json",
          max_epochs: 1,
          allow_dynamic_sections: false,
        },
        process.cwd(),
      ),
    ).toThrow(/ace/);
  });

  it("defaults allow_dynamic_sections to false when omitted", () => {
    const config = parseOptimizerConfig(
      {
        type: "ace",
        eval_files: ["evals/basic.yaml"],
        playbook_path: "playbooks/basic.json",
        max_epochs: 3,
      },
      "/repo",
    );
    expect(config.allowDynamicSections).toBe(false);
  });
});
