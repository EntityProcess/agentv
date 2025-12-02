import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPromptInputs, isGuidelineFile, loadEvalCases } from "../../src/evaluation/yaml-parser.js";

describe("isGuidelineFile", () => {
  describe("with explicit patterns", () => {
    const defaultPatterns = [
      "**/*.instructions.md",
      "**/instructions/**",
      "**/*.prompt.md",
      "**/prompts/**",
    ];

    it("matches .instructions.md files", () => {
      expect(isGuidelineFile("docs/coding.instructions.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("path/to/api.instructions.md", defaultPatterns)).toBe(true);
    });

    it("matches files in /instructions/ directories", () => {
      expect(isGuidelineFile("docs/instructions/coding.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("instructions/api-guide.md", defaultPatterns)).toBe(true);
    });

    it("matches .prompt.md files", () => {
      expect(isGuidelineFile("prompts/task.prompt.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("src/prompts/guide.prompt.md", defaultPatterns)).toBe(true);
    });

    it("matches files in /prompts/ directories", () => {
      expect(isGuidelineFile("prompts/task.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("src/prompts/guide.md", defaultPatterns)).toBe(true);
    });

    it("does not match regular files", () => {
      expect(isGuidelineFile("README.md", defaultPatterns)).toBe(false);
      expect(isGuidelineFile("src/utils/helper.ts", defaultPatterns)).toBe(false);
      expect(isGuidelineFile("docs/guide.md", defaultPatterns)).toBe(false);
    });

    it("normalizes Windows paths to forward slashes", () => {
      expect(isGuidelineFile("docs\\instructions\\guide.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("src\\prompts\\task.prompt.md", defaultPatterns)).toBe(true);
      expect(isGuidelineFile("docs\\guide.md", defaultPatterns)).toBe(false);
    });
  });

  describe("without patterns", () => {
    it("returns false by default", () => {
      expect(isGuidelineFile("docs/coding.instructions.md")).toBe(false);
      expect(isGuidelineFile("prompts/task.prompt.md")).toBe(false);
    });
  });

  describe("with custom patterns", () => {
    it("matches custom glob patterns", () => {
      const patterns = ["**/*.guide.md", "**/guidelines/**"];
      expect(isGuidelineFile("docs/api.guide.md", patterns)).toBe(true);
      expect(isGuidelineFile("guidelines/coding.md", patterns)).toBe(true);
    });

    it("does not match files outside custom patterns", () => {
      const patterns = ["**/*.guide.md"];
      expect(isGuidelineFile("docs/instructions/api.instructions.md", patterns)).toBe(false);
      expect(isGuidelineFile("prompts/task.prompt.md", patterns)).toBe(false);
    });

    it("handles exact path patterns", () => {
      const patterns = ["docs/AGENTS.md", "**/*.rules.md"];
      expect(isGuidelineFile("docs/AGENTS.md", patterns)).toBe(true);
      expect(isGuidelineFile("src/typescript.rules.md", patterns)).toBe(true);
      expect(isGuidelineFile("docs/README.md", patterns)).toBe(false);
    });
  });
});

describe("buildPromptInputs chatPrompt", () => {
  it("builds chatPrompt with merged system and embedded files", async () => {
    const tempDir = path.join(tmpdir(), `agentv-prompt-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const guidelinePath = path.join(tempDir, "rules.instructions.md");
    await writeFile(guidelinePath, "Be concise.", "utf8");

    const promptInputs = await buildPromptInputs({
      id: "multi",
      dataset: "ds",
      question: "placeholder",
      input_messages: [
        { role: "system", content: "Base system" },
        {
          role: "user",
          content: [
            { type: "file", value: "code.js" },
            { type: "text", value: "Review it" },
          ],
        },
        { role: "assistant", content: "Sure" },
      ],
      input_segments: [
        { type: "text", value: "Base system" },
        { type: "file", path: "code.js", text: "console.log('hi');" },
        { type: "text", value: "Review it" },
        { type: "text", value: "Sure" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [guidelinePath],
      guideline_patterns: ["**/*.instructions.md"],
      file_paths: [],
      code_snippets: [],
      expected_outcome: "ok",
      evaluator: "llm_judge",
    });

    expect(promptInputs.chatPrompt).toBeDefined();
    const chatPrompt = promptInputs.chatPrompt!;

    const msg0 = chatPrompt[0];
    if (msg0.role !== "system") throw new Error("Expected system message");
    expect(msg0.content).toContain("Base system");
    expect(msg0.content).toContain("Guidelines");
    expect(msg0.content).toContain("rules.instructions.md");

    expect(chatPrompt[1]).toEqual({
      role: "user",
      content: "<file path=\"code.js\">\nconsole.log('hi');\n</file>\nReview it",
    });
    expect(chatPrompt[2]).toEqual({
      role: "assistant",
      content: "Sure",
    });

    expect(promptInputs.question).toContain("@[Assistant]:");
  });

  it("omits chatPrompt for single user message", async () => {
    const promptInputs = await buildPromptInputs({
      id: "single",
      dataset: "ds",
      question: "placeholder",
      input_messages: [{ role: "user", content: "Only user" }],
      input_segments: [{ type: "text", value: "Only user" }],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [],
      file_paths: [],
      code_snippets: [],
      expected_outcome: "ok",
      evaluator: "llm_judge",
    });

    expect(promptInputs.chatPrompt).toBeUndefined();
    expect(promptInputs.question.trim()).toBe("Only user");
  });

  it("filters guideline-only messages from chatPrompt", async () => {
    const tempDir = path.join(tmpdir(), `agentv-guides-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const guidelinePath = path.join(tempDir, "guide.instructions.md");
    await writeFile(guidelinePath, "Follow rules", "utf8");

    const promptInputs = await buildPromptInputs({
      id: "guideline-only",
      dataset: "ds",
      question: "placeholder",
      input_messages: [
        { role: "system", content: "Base" },
        {
          role: "user",
          content: [{ type: "file", value: "guide.instructions.md" }],
        },
        { role: "user", content: "Real content" },
      ],
      input_segments: [
        { type: "text", value: "Base" },
        { type: "text", value: "<Attached: guide.instructions.md>" },
        { type: "text", value: "Real content" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [guidelinePath],
      guideline_patterns: ["**/*.instructions.md"],
      file_paths: [],
      code_snippets: [],
      expected_outcome: "ok",
      evaluator: "llm_judge",
    });

    expect(promptInputs.chatPrompt).toBeDefined();
    const chatPrompt = promptInputs.chatPrompt!;
    // guideline-only user message should be removed after extraction
    expect(chatPrompt).toHaveLength(2);
    const msg0 = chatPrompt[0];
    if (msg0.role !== "system") throw new Error("Expected system message");
    expect(msg0.content).toContain("Follow rules");
    expect(chatPrompt[1]).toEqual({ role: "user", content: "Real content" });
  });

  it("does not elevate bracketed markers inside user text", async () => {
    const promptInputs = await buildPromptInputs({
      id: "marker-text",
      dataset: "ds",
      question: "placeholder",
      input_messages: [
        { role: "user", content: "@[superman]: hello" },
        { role: "assistant", content: "ack" },
      ],
      input_segments: [
        { type: "text", value: "@[superman]: hello" },
        { type: "text", value: "ack" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [],
      file_paths: [],
      code_snippets: [],
      expected_outcome: "ok",
      evaluator: "llm_judge",
    });

    expect(promptInputs.chatPrompt).toEqual([
      { role: "user", content: "@[superman]: hello" },
      { role: "assistant", content: "ack" },
    ]);
    // Logging question still uses role markers for readability only
    expect(promptInputs.question).toContain("@[User]:");
    expect(promptInputs.question).toContain("@[Assistant]:");
    expect(promptInputs.question).toContain("@[superman]: hello");
  });
});

describe("loadTestCases with .agentv/config.yaml", () => {
  let testDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(tmpdir(), `agentv-test-${Date.now()}`);
    repoRoot = testDir;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it("uses custom guideline_patterns from .agentv/config.yaml", async () => {
    // Create .agentv directory and config file
    const agentvDir = path.join(testDir, ".agentv");
    await mkdir(agentvDir, { recursive: true });
    const configContent = `$schema: agentv-config-v2
guideline_patterns:
  - "**/*.guide.md"
  - "**/rules/**"
`;
    await writeFile(path.join(agentvDir, "config.yaml"), configContent, "utf8");

    // Create test guideline file matching custom pattern
    const guidelineContent = "# Custom Guideline\nFollow these rules.";
    await writeFile(path.join(testDir, "api.guide.md"), guidelineContent, "utf8");

    // Create standard instruction file (should NOT match custom patterns)
    const instructionContent = "# Standard Instruction\nOld format.";
    await writeFile(path.join(testDir, "coding.instructions.md"), instructionContent, "utf8");

    // Create eval file
    const evalContent = `$schema: agentv-eval-v2
evaluator: llm_judge
evalcases:
  - id: test-custom-patterns
    outcome: Success
    input_messages:
      - role: user
        content:
          - type: file
            value: api.guide.md
          - type: file
            value: coding.instructions.md
          - type: text
            value: Apply guidelines
    expected_messages:
      - role: assistant
        content: Done
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    // Load test cases
    const testCases = await loadEvalCases(evalPath, repoRoot);

    expect(testCases).toHaveLength(1);
    const testCase = testCases[0];

    // api.guide.md should be treated as guideline (matches custom pattern)
    expect(testCase.guideline_paths).toHaveLength(1);
    expect(testCase.guideline_paths[0]).toContain("api.guide.md");

    // coding.instructions.md should be treated as regular file (doesn't match custom pattern)
    expect(testCase.input_segments).toHaveLength(2); // file + text
    const fileSegment = testCase.input_segments.find(
      (seg) => seg.type === "file" && typeof seg.path === "string" && seg.path.includes("coding.instructions.md")
    );
    expect(fileSegment).toBeDefined();
  });

  it("uses no patterns when .agentv/config.yaml is absent", async () => {
    // Create standard instruction file
    const instructionContent = "# Standard Instruction\nDefault pattern.";
    await writeFile(path.join(testDir, "coding.instructions.md"), instructionContent, "utf8");

    // Create eval file
    const evalContent = `$schema: agentv-eval-v2
evaluator: llm_judge
evalcases:
  - id: test-default-patterns
    outcome: Success
    input_messages:
      - role: user
        content:
          - type: file
            value: coding.instructions.md
          - type: text
            value: Apply guidelines
    expected_messages:
      - role: assistant
        content: Done
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    // Load test cases
    const testCases = await loadEvalCases(evalPath, repoRoot);

    expect(testCases).toHaveLength(1);
    const testCase = testCases[0];

    // coding.instructions.md should NOT be treated as guideline (no default patterns)
    expect(testCase.guideline_paths).toHaveLength(0);
    
    // It should be treated as a regular file
    expect(testCase.input_segments).toHaveLength(2); // file + text
    const fileSegment = testCase.input_segments.find(
      (seg) => seg.type === "file" && typeof seg.path === "string" && seg.path.includes("coding.instructions.md")
    );
    expect(fileSegment).toBeDefined();
  });

  it("walks up directory tree to find config at repo root", async () => {
    // Create config at repo root
    const agentvDir = path.join(testDir, ".agentv");
    await mkdir(agentvDir, { recursive: true });
    const configContent = `$schema: agentv-config-v2
guideline_patterns:
  - "**/*.guide.md"
`;
    await writeFile(path.join(agentvDir, "config.yaml"), configContent, "utf8");

    // Create nested directory structure for eval file
    const evalsDir = path.join(testDir, "docs", "evals");
    await mkdir(evalsDir, { recursive: true });

    // Create guideline file in nested directory
    const guidelineContent = "# Nested Guideline\nShould use root config.";
    await writeFile(path.join(evalsDir, "api.guide.md"), guidelineContent, "utf8");

    // Create standard instruction (should NOT match custom pattern from root config)
    const instructionContent = "# Standard Instruction\nOld format.";
    await writeFile(path.join(evalsDir, "coding.instructions.md"), instructionContent, "utf8");

    // Create eval file in nested directory
    const evalContent = `$schema: agentv-eval-v2
evaluator: llm_judge
evalcases:
  - id: test-walk-up
    outcome: Success
    input_messages:
      - role: user
        content:
          - type: file
            value: api.guide.md
          - type: file
            value: coding.instructions.md
          - type: text
            value: Apply guidelines
    expected_messages:
      - role: assistant
        content: Done
`;
    const evalPath = path.join(evalsDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    // Load test cases
    const testCases = await loadEvalCases(evalPath, repoRoot);

    expect(testCases).toHaveLength(1);
    const testCase = testCases[0];

    // api.guide.md should be treated as guideline (matches pattern from root config)
    expect(testCase.guideline_paths).toHaveLength(1);
    expect(testCase.guideline_paths[0]).toContain("api.guide.md");

    // coding.instructions.md should be treated as regular file (doesn't match root config pattern)
    expect(testCase.input_segments).toHaveLength(2); // file + text
    const fileSegment = testCase.input_segments.find(
      (seg) => seg.type === "file" && typeof seg.path === "string" && seg.path.includes("coding.instructions.md")
    );
    expect(fileSegment).toBeDefined();
  });

  it("handles cross-platform paths in patterns", async () => {
    // Create .agentv directory and config with patterns
    const agentvDir = path.join(testDir, ".agentv");
    await mkdir(agentvDir, { recursive: true });
    const configContent = `$schema: agentv-config-v2
guideline_patterns:
  - "**/guidelines/**/*.md"
`;
    await writeFile(path.join(agentvDir, "config.yaml"), configContent, "utf8");

    // Create nested directory structure
    const guidelinesDir = path.join(testDir, "docs", "guidelines");
    await mkdir(guidelinesDir, { recursive: true });
    
    const guidelineContent = "# Nested Guideline\nCross-platform test.";
    await writeFile(path.join(guidelinesDir, "style.md"), guidelineContent, "utf8");

    // Create eval file
    const evalContent = `$schema: agentv-eval-v2
evaluator: llm_judge
evalcases:
  - id: test-cross-platform
    outcome: Success
    input_messages:
      - role: user
        content:
          - type: file
            value: docs/guidelines/style.md
          - type: text
            value: Apply style guide
    expected_messages:
      - role: assistant
        content: Done
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    // Load test cases
    const testCases = await loadEvalCases(evalPath, repoRoot);

    expect(testCases).toHaveLength(1);
    const testCase = testCases[0];

    // Should match regardless of platform path separators
    expect(testCase.guideline_paths).toHaveLength(1);
    expect(testCase.guideline_paths[0]).toContain("style.md");
  });
});

describe("buildPromptInputs - Multi-turn formatting", () => {
  let testDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `agentv-multiturn-test-${Date.now()}`);
    repoRoot = testDir;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("uses role markers for multi-turn conversations with assistant messages", async () => {
    const evalContent = `$schema: agentv-eval-v2
evalcases:
  - id: multi-turn-test
    outcome: Success
    input_messages:
      - role: system
        content: You are a helpful assistant.
      - role: user
        content: What is 2+2?
      - role: assistant
        content: Could you clarify what you mean?
      - role: user
        content: I mean the sum.
    expected_messages:
      - role: assistant
        content: The answer is 4.
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    const { buildPromptInputs } = await import("../../src/evaluation/yaml-parser.js");
    const testCases = await loadEvalCases(evalPath, repoRoot);
    const result = await buildPromptInputs(testCases[0]);

    // Should include role markers
    expect(result.question).toContain("@[System]:");
    expect(result.question).toContain("@[User]:");
    expect(result.question).toContain("@[Assistant]:");
    expect(result.question).toMatch(/@\[System\]:\s*You are a helpful assistant\./);
    expect(result.question).toMatch(/@\[User\]:\s*What is 2\+2\?/);
    expect(result.question).toMatch(/@\[Assistant\]:\s*Could you clarify/);
  });

  it("uses role markers for system + user pattern with text content", async () => {
    const evalContent = `$schema: agentv-eval-v2
evalcases:
  - id: single-turn-test
    outcome: Success
    input_messages:
      - role: system
        content: You are a helpful assistant.
      - role: user
        content: What is 2+2?
    expected_messages:
      - role: assistant
        content: The answer is 4.
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    const { buildPromptInputs } = await import("../../src/evaluation/yaml-parser.js");
    const testCases = await loadEvalCases(evalPath, repoRoot);
    const result = await buildPromptInputs(testCases[0]);

    // Should include role markers for multiple messages with content
    expect(result.question).toContain("@[System]:");
    expect(result.question).toContain("@[User]:");
    expect(result.question).toMatch(/@\[System\]:\s*You are a helpful assistant\./);
    expect(result.question).toMatch(/@\[User\]:\s*What is 2\+2\?/);
  });

  it("uses role markers for multiple user messages", async () => {
    const evalContent = `$schema: agentv-eval-v2
evalcases:
  - id: multi-user-test
    outcome: Success
    input_messages:
      - role: user
        content: First question
      - role: user
        content: Second question
    expected_messages:
      - role: assistant
        content: Answer
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    const { buildPromptInputs } = await import("../../src/evaluation/yaml-parser.js");
    const testCases = await loadEvalCases(evalPath, repoRoot);
    const result = await buildPromptInputs(testCases[0]);

    // Should include role markers for multiple user messages
    expect(result.question).toContain("@[User]:");
    expect(result.question).toMatch(/@\[User\]:\s*First question/);
    expect(result.question).toMatch(/@\[User\]:\s*Second question/);
  });

  it("shows guideline file references with role markers", async () => {
    // Create a guidelines file
    const guidelinesDir = path.join(testDir, ".agentv");
    await mkdir(guidelinesDir, { recursive: true });
    await writeFile(path.join(guidelinesDir, "config.yaml"), `$schema: agentv-config-v2
guideline_patterns:
  - "**/*.instructions.md"
`, "utf8");

    const instructionContent = "# Instructions\nBe helpful.";
    await writeFile(path.join(testDir, "guide.instructions.md"), instructionContent, "utf8");

    const evalContent = `$schema: agentv-eval-v2
evalcases:
  - id: system-file-test
    outcome: Success
    input_messages:
      - role: system
        content:
          - type: file
            value: guide.instructions.md
      - role: user
        content: Help me with this task
    expected_messages:
      - role: assistant
        content: Sure
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    const { buildPromptInputs } = await import("../../src/evaluation/yaml-parser.js");
    const testCases = await loadEvalCases(evalPath, repoRoot);
    const result = await buildPromptInputs(testCases[0]);

    // System guideline-only message is extracted; question remains flat
    expect(result.question).not.toContain("@[System]:");
    expect(result.question).not.toContain("@[User]:");
    expect(result.question.trim()).toBe("Help me with this task");
    
    // Full guideline content should be in guidelines field
    expect(result.guidelines).toContain("Be helpful");
  });

  it("shows regular file attachments with role markers", async () => {
    // Create a regular (non-guideline) file
    const codeContent = "function hello() { return 'world'; }";
    await writeFile(path.join(testDir, "code.ts"), codeContent, "utf8");

    const evalContent = `$schema: agentv-eval-v2
evalcases:
  - id: file-attachment-test
    outcome: Success
    input_messages:
      - role: system
        content: You are a code reviewer.
      - role: user
        content:
          - type: text
            value: Please review this code
          - type: file
            value: code.ts
    expected_messages:
      - role: assistant
        content: Looks good
`;
    const evalPath = path.join(testDir, "test.eval.yaml");
    await writeFile(evalPath, evalContent, "utf8");

    const { buildPromptInputs } = await import("../../src/evaluation/yaml-parser.js");
    const testCases = await loadEvalCases(evalPath, repoRoot);
    const result = await buildPromptInputs(testCases[0]);

    // Should use role markers (2 messages with content)
    expect(result.question).toContain("@[System]:");
    expect(result.question).toContain("@[User]:");
    
    // Regular files should be embedded inline with their content
    expect(result.question).toContain("<file path=\"code.ts\">");
    expect(result.question).toContain("function hello()");
    expect(result.question).toContain("</file>");
  });
});
