import { describe, expect, it } from "vitest";
import {
  Converter,
  MAX_COMPLETIONS,
  plainSnippet,
  UnsupportedEdit,
  inactiveLinesOf,
  inlayHintsOf,
} from "./convert";
import { pathsFor } from "./uri";

const root = "/work/proj";
const paths = pathsFor("linux");
const outside: string[] = [];
const c = new Converter(root, paths, (f) => outside.push(f));
const uri = (p: string) => paths.toUri(root, p);

const r = (
  line: number,
  character: number,
  endLine = line,
  endCharacter = character + 1,
) => ({
  start: { line, character },
  end: { line: endLine, character: endCharacter },
});

describe("hover", () => {
  it("reads every shape of contents", () => {
    expect(
      c.hover({ contents: { kind: "markdown", value: "**x**" } })?.markdown,
    ).toBe("**x**");
    expect(c.hover({ contents: "plain" })?.markdown).toBe("plain");
    expect(
      c.hover({ contents: { language: "rust", value: "fn f()" } })?.markdown,
    ).toBe("```rust\nfn f()\n```");
    expect(
      c.hover({ contents: [{ language: "ts", value: "let a" }, "docs", ""] })
        ?.markdown,
    ).toBe("```ts\nlet a\n```\n\ndocs");
  });

  it("is nothing when the server has nothing to say", () => {
    expect(c.hover(null)).toBeNull();
    expect(c.hover({ contents: "  " })).toBeNull();
    expect(c.hover({ contents: [] })).toBeNull();
  });
});

describe("locations", () => {
  it("takes one, a list or links, and skips what isn't a file here", () => {
    const loc = { uri: uri("a.rs"), range: r(1, 2, 1, 5) };
    const link = {
      targetUri: uri("b.rs"),
      targetRange: r(0, 0, 9, 0),
      targetSelectionRange: r(3, 4),
    };
    const odd = { uri: "jar:file:///x.jar!/A.class", range: r(0, 0) };
    expect(c.locations(loc)).toEqual([
      {
        path: "a.rs",
        outside: false,
        line: 1,
        character: 2,
        endLine: 1,
        endCharacter: 5,
      },
    ]);
    expect(c.locations([link, odd, null, { uri: uri("c.rs") }])).toEqual([
      {
        path: "b.rs",
        outside: false,
        line: 3,
        character: 4,
        endLine: 3,
        endCharacter: 5,
      },
    ]);
    expect(c.locations(null)).toEqual([]);
  });

  it("remembers the outside files it was pointed at", () => {
    outside.length = 0;
    c.locations({ uri: "file:///usr/lib/x.rs", range: r(0, 0) });
    expect(outside).toEqual(["/usr/lib/x.rs"]);
  });
});

describe("completions", () => {
  it("uses the edit's text and range over the label", () => {
    const { items } = c.completions([
      {
        label: "println!",
        kind: 3,
        textEdit: { range: r(2, 4, 2, 7), newText: "println!" },
        labelDetails: { detail: "(…)", description: "macro" },
      },
    ]);
    expect(items).toEqual([
      {
        label: "println!",
        kind: "function",
        detail: "(…) macro",
        insertText: "println!",
        replace: { line: 2, character: 4, endLine: 2, endCharacter: 7 },
      },
    ]);
  });

  it("takes an insert/replace edit's insert range", () => {
    const [item] = c.completions({
      items: [
        {
          label: "x",
          textEdit: {
            newText: "x",
            insert: r(0, 0, 0, 1),
            replace: r(0, 0, 0, 5),
          },
        },
      ],
    }).items;
    expect(item.replace).toEqual({
      line: 0,
      character: 0,
      endLine: 0,
      endCharacter: 1,
    });
  });

  it("turns a snippet it was sent anyway into plain text", () => {
    expect(plainSnippet("foo(${1:a}, ${2:b})$0")).toBe("foo(a, b)");
    expect(plainSnippet("${1|x,y|} \\$5")).toBe("x $5");
    const [item] = c.completions([
      { label: "foo", insertText: "foo($1)", insertTextFormat: 2 },
    ]).items;
    expect(item.insertText).toBe("foo()");
  });

  it("keeps additional edits and the deprecated mark", () => {
    const [item] = c.completions([
      {
        label: "Map",
        tags: [1],
        additionalTextEdits: [{ range: r(0, 0, 0, 0), newText: "use Map;\n" }],
      },
    ]).items;
    expect(item.deprecated).toBe(true);
    expect(item.additionalEdits).toEqual([
      {
        line: 0,
        character: 0,
        endLine: 0,
        endCharacter: 0,
        newText: "use Map;\n",
      },
    ]);
  });

  it("cuts a huge list by the server's own order and says it is incomplete", () => {
    const list = Array.from({ length: MAX_COMPLETIONS + 50 }, (_, i) => ({
      label: `i${i}`,
      sortText: String(i).padStart(5, "0"),
    }));
    const out = c.completions({
      isIncomplete: false,
      items: [...list].reverse(),
    });
    expect(out.items).toHaveLength(MAX_COMPLETIONS);
    expect(out.items[0].label).toBe("i0");
    expect(out.incomplete).toBe(true);
    expect(c.completions({ isIncomplete: true, items: [] }).incomplete).toBe(
      true,
    );
  });

  it("drops an item with no label", () => {
    expect(c.completions([{ kind: 3 }, null]).items).toEqual([]);
  });
});

describe("workspace edits", () => {
  it("merges changes by file", () => {
    const out = c.workspaceEdit({
      changes: {
        [uri("a.rs")]: [{ range: r(0, 0), newText: "x" }],
        "file:///usr/lib/std.rs": [{ range: r(1, 1), newText: "y" }],
      },
    });
    expect(out.map((f) => f.path)).toEqual(["a.rs", "/usr/lib/std.rs"]);
  });

  it("reads documentChanges, annotated edits included", () => {
    const out = c.workspaceEdit({
      documentChanges: [
        {
          textDocument: { uri: uri("a.rs"), version: 1 },
          edits: [{ range: r(0, 0), newText: "x" }],
        },
        {
          textDocument: { uri: uri("a.rs"), version: 1 },
          edits: [{ range: r(2, 0), newText: "z", annotationId: "q" }],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].edits.map((e) => e.newText)).toEqual(["x", "z"]);
  });

  it("refuses an edit that creates, moves or deletes files", () => {
    expect(() =>
      c.workspaceEdit({
        documentChanges: [
          { kind: "rename", oldUri: uri("a.rs"), newUri: uri("b.rs") },
        ],
      }),
    ).toThrow(UnsupportedEdit);
  });

  it("is empty for nothing", () => {
    expect(c.workspaceEdit(null)).toEqual([]);
    expect(c.workspaceEdit({ changes: {} })).toEqual([]);
  });
});

describe("diagnostics", () => {
  it("defaults to an error and reads the code however it is given", () => {
    expect(
      c.diagnostics([
        { range: r(0, 0, 0, 3), message: "a" },
        { range: r(1, 0), severity: 2, message: "b", code: 7 },
        {
          range: r(2, 0),
          severity: 4,
          message: "c",
          code: { value: "X1" },
          source: "ts",
        },
        { range: r(3, 0), severity: 3, message: "d" },
        { message: "no range" },
      ]),
    ).toEqual([
      {
        line: 0,
        character: 0,
        endLine: 0,
        endCharacter: 3,
        severity: "error",
        message: "a",
      },
      {
        line: 1,
        character: 0,
        endLine: 1,
        endCharacter: 1,
        severity: "warning",
        message: "b",
        code: "7",
      },
      {
        line: 2,
        character: 0,
        endLine: 2,
        endCharacter: 1,
        severity: "hint",
        message: "c",
        code: "X1",
        source: "ts",
      },
      {
        line: 3,
        character: 0,
        endLine: 3,
        endCharacter: 1,
        severity: "info",
        message: "d",
      },
    ]);
  });
});

describe("symbols", () => {
  it("reads the flat form with a location and a container", () => {
    expect(
      c.documentSymbols(
        [
          {
            name: "f",
            kind: 12,
            containerName: "m",
            location: { uri: uri("a.rs"), range: r(4, 2, 6, 1) },
          },
        ],
        { path: "a.rs" },
      ),
    ).toEqual([
      {
        name: "f",
        kind: "function",
        path: "a.rs",
        line: 4,
        character: 2,
        endLine: 6,
        endCharacter: 1,
        container: "m",
      },
    ]);
  });

  it("puts a workspace symbol without a range at the top of its file", () => {
    expect(
      c.workspaceSymbols([
        { name: "T", kind: 23, location: { uri: uri("a.rs") } },
      ]),
    ).toEqual([
      { name: "T", kind: "struct", path: "a.rs", line: 0, character: 0 },
    ]);
  });
});

describe("inlayHintsOf", () => {
  it("joins label parts and names the kinds", () => {
    expect(
      inlayHintsOf([
        { position: { line: 3, character: 9 }, label: ": KnownMessages", kind: 1, paddingLeft: true },
        { position: { line: 4, character: 2 }, label: [{ value: "failure" }, { value: ":" }], kind: 2, paddingRight: true },
        { position: { line: 5 }, label: "broken" },
      ]),
    ).toEqual([
      { line: 3, character: 9, label: ": KnownMessages", kind: "type", paddingLeft: true, paddingRight: false },
      { line: 4, character: 2, label: "failure:", kind: "parameter", paddingLeft: false, paddingRight: true },
    ]);
  });
});

describe("inactiveLinesOf", () => {
  const range = (line: number, character: number, endLine: number, endCharacter: number) => ({
    start: { line, character },
    end: { line: endLine, character: endCharacter },
  });

  it("covers whole lines, leaving out a line the range only reaches the start of", () => {
    expect(inactiveLinesOf([range(7, 0, 10, 1), range(12, 0, 14, 0), "junk"])).toEqual([
      { from: 7, to: 10 },
      { from: 12, to: 13 },
    ]);
    expect(inactiveLinesOf(undefined)).toEqual([]);
  });
});
