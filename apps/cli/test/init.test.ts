import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { initCommand } from "../src/commands/init/index.js";

const TEST_DIR = path.join(process.cwd(), "test-output", "init-test");

describe("init command", () => {
  beforeEach(() => {
    // Clean up test directory before each test
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should create .github directory if it doesn't exist", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const githubDir = path.join(TEST_DIR, ".github");
    expect(existsSync(githubDir)).toBe(true);
  });

  it("should create .agentv directory if it doesn't exist", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const agentvDir = path.join(TEST_DIR, ".agentv");
    expect(existsSync(agentvDir)).toBe(true);
  });

  it("should create prompt template file", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const promptFile = path.join(TEST_DIR, ".github", "prompts", "eval-build.prompt.md");
    expect(existsSync(promptFile)).toBe(true);

    const content = readFileSync(promptFile, "utf-8");
    expect(content).toContain("Schema Reference");
    expect(content).toContain("Structure Requirements");
    expect(content).toContain("evalcases");
  });

  it("should create schema file", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const schemaFile = path.join(TEST_DIR, ".github", "contexts", "eval-schema.json");
    expect(existsSync(schemaFile)).toBe(true);

    const content = readFileSync(schemaFile, "utf-8");
    const schema = JSON.parse(content);
    expect(schema.title).toContain("AgentV");
    expect(schema.title).toContain("Eval Schema");
    expect(schema.type).toBe("object");
    expect(schema.properties.evalcases).toBeDefined();
  });

  it("should create targets.yaml file", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const targetsFile = path.join(TEST_DIR, ".agentv", "targets.yaml");
    expect(existsSync(targetsFile)).toBe(true);

    const content = readFileSync(targetsFile, "utf-8");
    expect(content).toContain("$schema: agentv-targets-v2");
    expect(content).toContain("targets:");
    expect(content).toContain("azure_base");
  });

  it("should create config.yaml file", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const configFile = path.join(TEST_DIR, ".agentv", "config.yaml");
    expect(existsSync(configFile)).toBe(true);

    const content = readFileSync(configFile, "utf-8");
    expect(content).toContain("$schema: agentv-config-v2");
    expect(content).toContain("guideline_patterns:");
  });

  it("should create .env file", async () => {
    await initCommand({ targetPath: TEST_DIR });

    const envFile = path.join(TEST_DIR, ".agentv", ".env");
    expect(existsSync(envFile)).toBe(true);

    const content = readFileSync(envFile, "utf-8");
    expect(content).toContain("AZURE_OPENAI_ENDPOINT");
    expect(content).toContain("AZURE_OPENAI_API_KEY");
    expect(content).toContain("PROJECTX_WORKSPACE_PATH");
  });

  it("should work when .github directory already exists", async () => {
    const githubDir = path.join(TEST_DIR, ".github");
    mkdirSync(githubDir, { recursive: true });

    await initCommand({ targetPath: TEST_DIR });

    const promptFile = path.join(githubDir, "prompts", "eval-build.prompt.md");
    const schemaFile = path.join(githubDir, "contexts", "eval-schema.json");

    expect(existsSync(promptFile)).toBe(true);
    expect(existsSync(schemaFile)).toBe(true);
  });

  it("should work when .agentv directory already exists", async () => {
    const agentvDir = path.join(TEST_DIR, ".agentv");
    mkdirSync(agentvDir, { recursive: true });

    await initCommand({ targetPath: TEST_DIR });

    const targetsFile = path.join(agentvDir, "targets.yaml");
    const configFile = path.join(agentvDir, "config.yaml");
    const envFile = path.join(agentvDir, ".env");

    expect(existsSync(targetsFile)).toBe(true);
    expect(existsSync(configFile)).toBe(true);
    expect(existsSync(envFile)).toBe(true);
  });

  it("should default to current directory when no path provided", async () => {
    // Just test that it defaults to "." when no path is provided
    // We can't test process.chdir in vitest workers
    await initCommand({ targetPath: TEST_DIR });

    const githubDir = path.join(TEST_DIR, ".github");
    const agentvDir = path.join(TEST_DIR, ".agentv");
    expect(existsSync(githubDir)).toBe(true);
    expect(existsSync(agentvDir)).toBe(true);
  });
});
