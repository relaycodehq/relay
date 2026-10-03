import { describe, expect, it } from "vitest";
import {
  codeReferenceMessage,
  parseCodeReferences,
  type CodeReference,
} from "./code-references";

const refs: CodeReference[] = [
  {
    path: "src/app/history.component.ts",
    start: 107,
    end: 109,
    label: "Working file",
    code: "private a = 1;\nprivate b = 2;\n/** doc */",
  },
  {
    path: "README.md",
    start: 3,
    end: 3,
    label: "HEAD",
    code: "```ts\nx\n```",
  },
];

describe("code references", () => {
  it("round-trips references and keeps the question", () => {
    const sent = codeReferenceMessage(refs, "Why is this here?");
    expect(sent).toContain(
      "About src/app/history.component.ts:107–109 (Working file):",
    );
    expect(parseCodeReferences(sent)).toEqual({
      refs,
      body: "Why is this here?",
    });
  });
  it("keeps a leading agent mention first", () => {
    const sent = codeReferenceMessage(refs.slice(0, 1), "@claude explain");
    expect(sent.startsWith("@claude About ")).toBe(true);
    const parsed = parseCodeReferences(sent);
    expect(parsed.refs).toEqual(refs.slice(0, 1));
    expect(parsed.body).toBe("@claude explain");
  });
  it("leaves ordinary messages alone", () => {
    expect(parseCodeReferences("About time: nothing")).toEqual({
      refs: [],
      body: "About time: nothing",
    });
  });
});
