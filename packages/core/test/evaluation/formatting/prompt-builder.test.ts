import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPromptInputs } from "../../../src/evaluation/yaml-parser.js";

describe("buildPromptInputs formatting modes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `agentv-fmt-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses LM mode by default - embeds file content", async () => {
    const promptInputs = await buildPromptInputs({
      id: "lm-default",
      dataset: "ds",
      question: "placeholder",
      input_messages: [
        {
          role: "user",
          content: [
            { type: "file", value: "example.ts" },
            { type: "text", value: "Review this code" },
          ],
        },
      ],
      input_segments: [
        { type: "file", path: "example.ts", text: "const x = 1;" },
        { type: "text", value: "Review this code" },
      ],
      output_segments: [],
      reference_answer: "",
      guideline_paths: [],
      file_paths: ["example.ts"],
      code_snippets: [],
      expected_outcome: "ok",
      evaluator: "llm_judge",
    });

    // LM mode should embed file content with XML tags
    expect(promptInputs.question).toContain('<file path="example.ts">');
    expect(promptInputs.question).toContain("const x = 1;");
    expect(promptInputs.question).toContain("</file>");
    expect(promptInputs.question).toContain("Review this code");
  });

  it("uses LM mode explicitly - embeds file content", async () => {
    const promptInputs = await buildPromptInputs(
      {
        id: "lm-explicit",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "config.json" },
              { type: "text", value: "Check this" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "config.json", text: '{"name": "test"}' },
          { type: "text", value: "Check this" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: ["config.json"],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "lm"
    );

    expect(promptInputs.question).toContain('<file path="config.json">');
    expect(promptInputs.question).toContain('{"name": "test"}');
    expect(promptInputs.question).toContain("</file>");
  });

  it("uses agent mode - returns file references only", async () => {
    const promptInputs = await buildPromptInputs(
      {
        id: "agent-mode",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "src/main.ts" },
              { type: "text", value: "Review this code" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "src/main.ts", text: "export const main = () => {}" },
          { type: "text", value: "Review this code" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: ["src/main.ts"],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "agent"
    );

    // Agent mode should only have file reference, not embedded content
    expect(promptInputs.question).toContain("<Attached: src/main.ts>");
    expect(promptInputs.question).not.toContain("export const main");
    expect(promptInputs.question).not.toContain("<file");
    expect(promptInputs.question).toContain("Review this code");
  });

  it("handles multiple files in agent mode - references only", async () => {
    const promptInputs = await buildPromptInputs(
      {
        id: "agent-multi",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "file1.ts" },
              { type: "file", value: "file2.ts" },
              { type: "text", value: "Compare these" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "file1.ts", text: "const a = 1;" },
          { type: "file", path: "file2.ts", text: "const b = 2;" },
          { type: "text", value: "Compare these" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: ["file1.ts", "file2.ts"],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "agent"
    );

    expect(promptInputs.question).toContain("<Attached: file1.ts>");
    expect(promptInputs.question).toContain("<Attached: file2.ts>");
    expect(promptInputs.question).not.toContain("const a = 1");
    expect(promptInputs.question).not.toContain("const b = 2");
    expect(promptInputs.question).toContain("Compare these");
  });

  it("handles multiple files in LM mode - embeds content", async () => {
    const promptInputs = await buildPromptInputs(
      {
        id: "lm-multi",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "file1.ts" },
              { type: "file", value: "file2.ts" },
              { type: "text", value: "Compare these" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "file1.ts", text: "const a = 1;" },
          { type: "file", path: "file2.ts", text: "const b = 2;" },
          { type: "text", value: "Compare these" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: ["file1.ts", "file2.ts"],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "lm"
    );

    expect(promptInputs.question).toContain('<file path="file1.ts">');
    expect(promptInputs.question).toContain("const a = 1;");
    expect(promptInputs.question).toContain('<file path="file2.ts">');
    expect(promptInputs.question).toContain("const b = 2;");
    expect(promptInputs.question).toContain("Compare these");
  });

  it("handles multi-turn conversation in agent mode", async () => {
    const promptInputs = await buildPromptInputs(
      {
        id: "agent-multiturn",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "code.ts" },
              { type: "text", value: "Review this" },
            ],
          },
          { role: "assistant", content: "Looks good" },
          {
            role: "user",
            content: [
              { type: "file", value: "test.ts" },
              { type: "text", value: "What about this?" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "code.ts", text: "const x = 1;" },
          { type: "text", value: "Review this" },
          { type: "text", value: "Looks good" },
          { type: "file", path: "test.ts", text: "const y = 2;" },
          { type: "text", value: "What about this?" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [],
        file_paths: ["code.ts", "test.ts"],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "agent"
    );

    // Should have role markers for multi-turn
    expect(promptInputs.question).toContain("@[User]:");
    expect(promptInputs.question).toContain("@[Assistant]:");
    
    // Should have file references, not content
    expect(promptInputs.question).toContain("<Attached: code.ts>");
    expect(promptInputs.question).toContain("<Attached: test.ts>");
    expect(promptInputs.question).not.toContain("const x = 1");
    expect(promptInputs.question).not.toContain("const y = 2");
  });

  it("handles guideline files - references in both modes", async () => {
    const guidelinePath = path.join(tempDir, "guide.instructions.md");
    await writeFile(guidelinePath, "Follow these rules", "utf8");

    const promptInputsLm = await buildPromptInputs(
      {
        id: "guideline-lm",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "guide.instructions.md" },
              { type: "text", value: "Do this" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "guide.instructions.md", text: "Follow these rules" },
          { type: "text", value: "Do this" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [guidelinePath],
        guideline_patterns: ["**/*.instructions.md"],
        file_paths: [],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "lm"
    );

    const promptInputsAgent = await buildPromptInputs(
      {
        id: "guideline-agent",
        dataset: "ds",
        question: "placeholder",
        input_messages: [
          {
            role: "user",
            content: [
              { type: "file", value: "guide.instructions.md" },
              { type: "text", value: "Do this" },
            ],
          },
        ],
        input_segments: [
          { type: "file", path: "guide.instructions.md", text: "Follow these rules" },
          { type: "text", value: "Do this" },
        ],
        output_segments: [],
        reference_answer: "",
        guideline_paths: [guidelinePath],
        guideline_patterns: ["**/*.instructions.md"],
        file_paths: [],
        code_snippets: [],
        expected_outcome: "ok",
        evaluator: "llm_judge",
      },
      "agent"
    );

    // Guideline files should be referenced in both modes (content is in guidelines field)
    expect(promptInputsLm.question).toContain(`<Attached: guide.instructions.md>`);
    expect(promptInputsAgent.question).toContain(`<Attached: guide.instructions.md>`);
    
    // Guidelines should be in separate field
    expect(promptInputsLm.guidelines).toContain("Follow these rules");
    expect(promptInputsAgent.guidelines).toContain("Follow these rules");
  });
});
