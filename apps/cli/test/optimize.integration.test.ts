import { execa, execaNode } from "execa";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

interface OptimizeFixture {
  readonly baseDir: string;
  readonly suiteDir: string;
  readonly evalFile: string;
  readonly configPath: string;
  readonly playbookPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const CLI_ENTRY = path.join(projectRoot, "apps/cli/src/cli.ts");
const MOCK_RUNNER = path.join(projectRoot, "apps/cli/test/fixtures/mock-run-evaluation.ts");
const require = createRequire(import.meta.url);
const TSX_LOADER = pathToFileURL(require.resolve("tsx")).href;
let coreBuilt = false;
let tempDirs: string[] = [];

beforeAll(async () => {
  if (!coreBuilt) {
    await execa("pnpm", ["--filter", "@agentv/core", "build"], { cwd: projectRoot });
    coreBuilt = true;
  }
}, 30000);

afterEach(async () => {
  const dirs = tempDirs;
  tempDirs = [];
  for (const dir of dirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

async function createFixture(): Promise<OptimizeFixture> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "agentv-optimize-"));
  tempDirs.push(baseDir);

  const suiteDir = path.join(baseDir, "suite");
  await mkdir(path.join(suiteDir, ".agentv"), { recursive: true });

  const targetsPath = path.join(suiteDir, ".agentv", "targets.yaml");
  await writeFile(
    targetsPath,
    `$schema: agentv-targets-v2.2
targets:
  - name: default
    provider: mock
`,
    "utf8",
  );

  const evalFile = path.join(suiteDir, "sample.test.yaml");
  await writeFile(
    evalFile,
    `$schema: agentv-eval-v2
description: Optimize command integration test
target: default
evalcases:
  - id: integration-case
    outcome: CLI optimize integration
    input_messages:
      - role: user
        content: "hello"
    expected_messages:
      - role: assistant
        content: "hi"
`,
    "utf8",
  );

  const configPath = path.join(baseDir, "optimizer.yaml");
  const playbookPath = path.join(baseDir, "playbooks", "ace-playbook.json");
  await writeFile(
    configPath,
    `type: ace
description: Optimize integration
eval_files:
  - ${path.relative(path.dirname(configPath), evalFile)}
playbook_path: ${path.relative(path.dirname(configPath), playbookPath)}
max_epochs: 2
allow_dynamic_sections: true
`,
    "utf8",
  );

  return { baseDir, suiteDir, evalFile, configPath, playbookPath };
}

async function runCli(fixture: OptimizeFixture): Promise<{ stdout: string; stderr: string }> {
  const baseEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  delete baseEnv.CLI_ENV_SAMPLE;

  const result = await execaNode(CLI_ENTRY, ["optimize", fixture.configPath], {
    cwd: fixture.suiteDir,
    env: {
      ...baseEnv,
      CI: "true",
      AGENTEVO_CLI_EVAL_RUNNER: MOCK_RUNNER,
    },
    nodeOptions: ["--import", TSX_LOADER],
    reject: false,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}

describe("optimize command", () => {
  it("runs ACE optimization and writes playbook output", async () => {
    const fixture = await createFixture();
    const { stdout, stderr } = await runCli(fixture);

    expect(stderr).toBe("");
    expect(stdout).toContain("Optimization complete");
    expect(await readFile(fixture.playbookPath, "utf8")).toBeTruthy();

    const playbook = JSON.parse(await readFile(fixture.playbookPath, "utf8")) as {
      sections: Record<string, unknown[]>;
      stats?: { bulletCount?: number };
      updatedAt?: string;
    };
    const bulletTotal = Object.values(playbook.sections ?? {}).reduce(
      (sum, bullets) => sum + bullets.length,
      0,
    );

    expect(bulletTotal).toBe(2);
    expect(playbook.stats?.bulletCount).toBe(bulletTotal);
    expect(typeof playbook.updatedAt).toBe("string");
  });
});
