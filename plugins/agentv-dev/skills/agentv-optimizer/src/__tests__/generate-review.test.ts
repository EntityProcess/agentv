import { describe, expect, it } from "vitest";
import { renderReviewHtml } from "../../eval-viewer/generate-review";

describe("generate review", () => {
  it("renders review html from the report model", () => {
    const html = renderReviewHtml({
      title: "Optimizer Review",
      sections: [{ heading: "Summary", body: "Pass rate improved" }],
      testCases: [{ id: "case-1", status: "pass", summary: "baseline" }],
    });
    expect(html).toContain("Optimizer Review");
    expect(html).toContain("case-1");
  });
});
