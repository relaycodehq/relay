import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FileTag } from "../../src/components/composer-prompt/pills";
import { promptContent } from "../../src/lib/prompt-content";
import { promptText } from "../../src/lib/prompt-text";

const schema = getSchema([StarterKit, FileTag]);

it("restores dropped files as tags and leaves typed paths as text", () => {
  const draft =
    "Compare `/Users/me/Downloads/Q3 report.pdf` with the `/api/users` route";
  const nodes = promptContent(
    draft,
    {},
    [],
    ["/Users/me/Downloads/Q3 report.pdf"],
  ).content![0].content!;
  expect(nodes.filter((n) => n.type === "relayFile")).toEqual([
    {
      type: "relayFile",
      attrs: { path: "/Users/me/Downloads/Q3 report.pdf" },
    },
  ]);
  expect(nodes.map((n) => n.text ?? "").join("")).toContain("`/api/users`");
  expect(
    promptText(
      schema.nodeFromJSON(
        promptContent(draft, {}, [], ["/Users/me/Downloads/Q3 report.pdf"]),
      ),
    ),
  ).toBe(draft);
});

it("tags Windows paths too", () => {
  const nodes = promptContent(
    "`C:\\Users\\me\\a.csv`",
    {},
    [],
    ["C:\\Users\\me\\a.csv"],
  ).content![0].content!;
  expect(nodes).toEqual([
    { type: "relayFile", attrs: { path: "C:\\Users\\me\\a.csv" } },
  ]);
});
