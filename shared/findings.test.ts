import { describe, expect, it } from "vitest";
import { extractFindings, fixRequest } from "./findings";

describe("findings block", () => {
  it("splits the lead's findings off its answer", () => {
    const { body, report } = extractFindings(
      'Fix `F1` first.\n\n```relay-findings\n{"findings":[{"id":"F1","priority":"P1","title":"Queue drops a message","files":[{"path":"src/q.ts","line":3}],"reviewers":[1,31]}],"dropped":[{"title":"Nit","reason":"Style only"}]}\n```\n',
    );
    expect(body).toBe("Fix `F1` first.");
    expect(report?.findings).toEqual([
      {
        id: "F1",
        priority: "P1",
        title: "Queue drops a message",
        files: [{ path: "src/q.ts", line: 3 }],
        // A reviewer number that can't exist drops the list, not the finding.
        reviewers: [],
      },
    ]);
    expect(report?.dropped).toEqual([
      { title: "Nit", reason: "Style only", reviewers: [] },
    ]);
  });
  it("reads a block whose finding quotes a code fence", () => {
    const { body, report } = extractFindings(
      'See `F1`.\n\n```relay-findings\n{"findings":[{"id":"F1","priority":"P2","title":"Stops at the ``` in a string"}]}\n```',
    );
    expect(report?.findings.map((f) => f.title)).toEqual([
      "Stops at the ``` in a string",
    ]);
    expect(body).toBe("See `F1`.");
  });
  it("keeps an answer whose block isn't a report as it was", () => {
    for (const body of [
      "No findings block here.",
      "```relay-findings\nnot json\n```",
      '```relay-findings\n{"findings":[{"id":"X","priority":"P9"}]}\n```',
    ])
      expect(extractFindings(body)).toEqual({ body });
  });
  it("only takes a block that ends the answer", () => {
    const block = `\`\`\`relay-findings\n${JSON.stringify({ findings: [{ id: "F1", priority: "P2", title: "Short title" }] })}\n\`\`\``;
    expect(extractFindings(`Done.\n\n${block}\n\n`).report).toBeDefined();
    for (const body of [
      // Quoted mid-answer, as when explaining the format.
      `The lead ends with:\n\n${block}\n\nRelay turns that into cards.`,
      // Followed by another code block.
      `${block}\n\n\`\`\`ts\nconst x = 1;\n\`\`\``,
      // Never closed.
      block.slice(0, -4),
      // Not at the start of a line.
      `Like this: ${block}`,
      // Something after the tag.
      block.replace("relay-findings", "relay-findings json"),
    ])
      expect(extractFindings(body)).toEqual({ body });
  });
  it("writes a fix request the lead can read", () => {
    expect(
      fixRequest(
        "claude",
        [
          {
            id: "F2",
            priority: "P2",
            title: "Strip keeps animating",
            files: [],
            reviewers: [1],
          },
        ],
        "Keep the timing.",
      ),
    ).toBe(
      "@claude Fix this finding from the review:\n- `F2` Strip keeps animating (P2)\n\nKeep the timing.",
    );
  });
});
