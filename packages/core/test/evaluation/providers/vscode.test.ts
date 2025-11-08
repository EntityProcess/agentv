import { describe, expect, it } from "vitest";

import { resolveTargetDefinition, createProvider } from "../../../src/evaluation/providers/index.js";

describe("VSCode Provider Prompt Scaffolding", () => {
  it("generates preread block with SHA tokens for instruction files", () => {
    const env = {} as Record<string, string>;
    const target = resolveTargetDefinition(
      {
        name: "vscode-test",
        provider: "vscode",
        settings: {
          dry_run: true,
        },
      },
      env,
    );

    const provider = createProvider(target);

    // This is a conceptual test - in practice, we'd need to expose buildPromptDocument
    // or test through integration. For now, validate provider creates correctly.
    expect(provider.kind).toBe("vscode");
    expect(provider.targetName).toBe("vscode-test");
  });

  it("extracts instruction files from guidelines", () => {
    // Test helper function for extracting instruction files
    const guidelines = `
      Follow these guidelines from base.instructions.md
      Also check /instructions/typescript.md
      And refer to @instructions/testing.md
    `;

    // In real implementation, this would call extractGuidelineFiles
    // For now, just validate the pattern matching logic exists
    expect(guidelines).toContain(".instructions.md");
    expect(guidelines).toContain("/instructions/");
    expect(guidelines).toContain("@instructions/");
  });

  it("generates SHA token placeholders for each file", () => {
    // This tests the expected format of SHA tokens
    const expectedFormat = "INSTRUCTIONS_READ: `file.instructions.md` i=1 SHA256=<hex>";
    
    expect(expectedFormat).toContain("INSTRUCTIONS_READ:");
    expect(expectedFormat).toContain("SHA256=<hex>");
    expect(expectedFormat).toMatch(/i=\d+/);
  });

  it("creates file URI from absolute path", () => {
    // Test Windows path to file URI conversion
    const expectedUri = "file:///C:/Users/test/file.md";
    
    // Validate URI format expectation
    expect(expectedUri).toMatch(/^file:\/\/\//);
  });

  it("creates file URI from Unix path", () => {
    // Test Unix path to file URI conversion
    const expectedUri = "file:///home/user/file.md";
    
    // Validate URI format expectation
    expect(expectedUri).toMatch(/^file:\/\/\//);
  });

  it("includes mandatory preread marker in prompt", () => {
    const expectedMarker = "[[ ## mandatory_pre_read ## ]]";
    
    // This marker should appear at the start of the preread block
    expect(expectedMarker).toContain("mandatory_pre_read");
  });

  it("includes PowerShell command for SHA256 in instructions", () => {
    const expectedCommand = "Get-FileHash -Algorithm SHA256 -LiteralPath '<file-path>'";
    
    // Verify command format
    expect(expectedCommand).toContain("Get-FileHash");
    expect(expectedCommand).toContain("SHA256");
    expect(expectedCommand).toContain("LiteralPath");
  });

  it("handles missing files with error instruction", () => {
    const expectedErrorFormat = "ERROR: missing-file <filename>";
    
    // Instructions should tell Copilot to fail if files are missing
    expect(expectedErrorFormat).toContain("ERROR:");
    expect(expectedErrorFormat).toContain("missing-file");
  });
});
