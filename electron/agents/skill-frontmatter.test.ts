import { expect, it } from "vitest";
import {
  parseYamlFields,
  skillFrontmatter,
  yamlBoolean,
} from "./skill-frontmatter";

it("reads the YAML skills use: blocks, lists, quotes and one nested level", () => {
  const text = [
    "---",
    "name: 'it''s'",
    "description: >",
    "  Folded over",
    "  two lines",
    "notes: |",
    "  kept",
    "  apart",
    "tools:",
    "  - Read",
    '  - "Write"',
    "metadata:",
    "  surfaces: [cli, ide]",
    "  owner: me # who",
    "long: starts here",
    "  and runs on",
    "---",
    "Body",
  ].join("\n");
  expect(skillFrontmatter(text)).toEqual({
    kind: "parsed",
    fields: {
      name: "it's",
      description: "Folded over two lines\n",
      notes: "kept\napart\n",
      tools: ["Read", "Write"],
      metadata: { surfaces: ["cli", "ide"], owner: "me" },
      long: "starts here and runs on",
    },
  });
  expect(skillFrontmatter("no block")).toEqual({ kind: "missing" });
  expect(parseYamlFields("  indented: first")).toEqual({
    kind: "parsed",
    fields: { indented: "first" },
  });
  expect(parseYamlFields("just words").kind).toBe("malformed");
  expect(["yes", "On", "1", "no", "OFF", "maybe"].map(yamlBoolean)).toEqual([
    true,
    true,
    true,
    false,
    false,
    undefined,
  ]);
});

it("repairs only Claude's plain colon scalars and keeps invalid YAML malformed", () => {
  expect(parseYamlFields("description: Review: code").kind).toBe("malformed");
  expect(parseYamlFields("description: Review: code # note", true)).toEqual({
    kind: "parsed",
    fields: { description: "Review: code" },
  });
  for (const text of ['description: "unclosed: quote', "tools: [Read, Write"])
    expect(parseYamlFields(text, true).kind).toBe("malformed");
  expect([true, false, 1, 0, 2, null].map(yamlBoolean)).toEqual([
    true,
    false,
    true,
    false,
    undefined,
    undefined,
  ]);
});
