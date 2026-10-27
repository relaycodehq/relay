import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalTab, detailSummary } from "./ApprovalTab";

it("sums a JSON detail up by its first line with words, not its brace", () => {
  const input = JSON.stringify({ command: "npm test", timeout: 60 }, null, 2);
  expect(detailSummary(input)).toBe('"command": "npm test"');
  expect(detailSummary("\n/Users/you/site\nGit repository.")).toBe(
    "/Users/you/site",
  );
  expect(detailSummary(undefined)).toBeUndefined();
});

it("shows one line with only the offered answers, Allow last", () => {
  const html = renderToStaticMarkup(
    <ApprovalTab
      request={{
        id: "r",
        kind: "approval",
        title: "Add “site” to Relay as a project?",
        detail: "/Users/you/site\nGit repository.",
        decisions: ["accept", "decline", "cancel"],
      }}
      pendingCount={1}
      onRespond={async () => {}}
    />,
  );
  expect(html).toContain("/Users/you/site");
  // Folded: the rest of the detail waits for a click.
  expect(html).not.toContain("Git repository.");
  const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
    (m) => m[1],
  );
  expect(buttons.filter((label) => label)).toEqual(["Decline", "Allow"]);
});
