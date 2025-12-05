import { describe, expect, it } from "vitest";

import { formatSegment, type FormattingMode } from "../../../src/evaluation/formatting/segment-formatter.js";
import type { JsonObject } from "../../../src/evaluation/types.js";

describe("formatSegment", () => {
  describe("text segments", () => {
    it("returns text value in both modes", () => {
      const segment: JsonObject = {
        type: "text",
        value: "Hello world",
      };

      expect(formatSegment(segment, "lm")).toBe("Hello world");
      expect(formatSegment(segment, "agent")).toBe("Hello world");
    });
  });

  describe("guideline_ref segments", () => {
    it("returns file reference in both modes", () => {
      const segment: JsonObject = {
        type: "guideline_ref",
        path: "docs/guide.instructions.md",
      };

      expect(formatSegment(segment, "lm")).toBe("<Attached: docs/guide.instructions.md>");
      expect(formatSegment(segment, "agent")).toBe("<Attached: docs/guide.instructions.md>");
    });
  });

  describe("file segments", () => {
    it("returns embedded content with XML tags in LM mode", () => {
      const segment: JsonObject = {
        type: "file",
        path: "src/example.ts",
        text: "export const hello = 'world';",
      };

      const result = formatSegment(segment, "lm");
      expect(result).toContain('<file path="src/example.ts">');
      expect(result).toContain("export const hello = 'world';");
      expect(result).toContain("</file>");
    });

    it("returns file reference only in agent mode", () => {
      const segment: JsonObject = {
        type: "file",
        path: "src/example.ts",
        text: "export const hello = 'world';",
      };

      const result = formatSegment(segment, "agent");
      expect(result).toBe("<Attached: src/example.ts>");
      expect(result).not.toContain("export const hello");
      expect(result).not.toContain("<file");
    });

    it("defaults to LM mode when mode is not specified", () => {
      const segment: JsonObject = {
        type: "file",
        path: "src/example.ts",
        text: "export const hello = 'world';",
      };

      const result = formatSegment(segment);
      expect(result).toContain('<file path="src/example.ts">');
      expect(result).toContain("export const hello = 'world';");
    });

    it("handles multiline file content in LM mode", () => {
      const segment: JsonObject = {
        type: "file",
        path: "config.json",
        text: '{\n  "name": "test",\n  "version": "1.0.0"\n}',
      };

      const result = formatSegment(segment, "lm");
      expect(result).toContain('<file path="config.json">');
      expect(result).toContain('"name": "test"');
      expect(result).toContain('"version": "1.0.0"');
      expect(result).toContain("</file>");
    });

    it("handles multiline file content in agent mode (reference only)", () => {
      const segment: JsonObject = {
        type: "file",
        path: "config.json",
        text: '{\n  "name": "test",\n  "version": "1.0.0"\n}',
      };

      const result = formatSegment(segment, "agent");
      expect(result).toBe("<Attached: config.json>");
      expect(result).not.toContain('"name"');
      expect(result).not.toContain("<file");
    });

    it("returns undefined when file has no path", () => {
      const segment: JsonObject = {
        type: "file",
        text: "some content",
      };

      expect(formatSegment(segment, "lm")).toBeUndefined();
      expect(formatSegment(segment, "agent")).toBeUndefined();
    });

    it("returns file reference in agent mode even without content", () => {
      const segment: JsonObject = {
        type: "file",
        path: "src/example.ts",
      };

      expect(formatSegment(segment, "agent")).toBe("<Attached: src/example.ts>");
    });

    it("returns undefined in LM mode when content is missing", () => {
      const segment: JsonObject = {
        type: "file",
        path: "src/example.ts",
      };

      expect(formatSegment(segment, "lm")).toBeUndefined();
    });
  });

  describe("unknown segment types", () => {
    it("returns undefined for unknown types", () => {
      const segment: JsonObject = {
        type: "unknown",
        value: "test",
      };

      expect(formatSegment(segment, "lm")).toBeUndefined();
      expect(formatSegment(segment, "agent")).toBeUndefined();
    });
  });
});
