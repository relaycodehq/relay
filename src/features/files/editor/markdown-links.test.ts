import { describe, expect, it } from "vitest";
import { headingSlugs, markdownLink } from "./markdown-links";

describe("markdownLink", () => {
  it("resolves relative links from the file's folder", () => {
    expect(markdownLink("docs/README.md", "guide.md")).toEqual({
      kind: "file",
      path: "docs/guide.md",
    });
    expect(markdownLink("docs/README.md", "../src/main.ts#L4")).toEqual({
      kind: "file",
      path: "src/main.ts",
    });
    expect(markdownLink("docs/README.md", "/LICENSE")).toEqual({
      kind: "file",
      path: "LICENSE",
    });
  });

  it("keeps sections in the same file, including a link to itself", () => {
    expect(markdownLink("README.md", "#getting-started")).toEqual({
      kind: "section",
      id: "getting-started",
    });
    expect(markdownLink("docs/a.md", "./a.md#%C3%BAvod")).toEqual({
      kind: "section",
      id: "úvod",
    });
  });

  it("tells links out of the project from URLs it leaves alone", () => {
    expect(markdownLink("README.md", "../../etc/passwd")).toEqual({
      kind: "outside",
    });
    expect(markdownLink("README.md", "https://example.com")).toBeUndefined();
    expect(markdownLink("README.md", "mailto:a@b.c")).toBeUndefined();
  });
});

describe("headingSlugs", () => {
  it("matches GitHub's anchors, numbering repeats", () => {
    expect(
      headingSlugs(["Getting Started!", "API: v2 (beta)", "Setup", "Setup"]),
    ).toEqual(["getting-started", "api-v2-beta", "setup", "setup-1"]);
  });
});
