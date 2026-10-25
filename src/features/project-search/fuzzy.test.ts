import { describe, expect, it } from "vitest";
import { parseFileQuery, PathIndex } from "./fuzzy";

const paths = [
  "src/features/files/ProjectFileViewer.tsx",
  "src/features/files/ProjectFiles.tsx",
  "src/features/files/project-files.css",
  "src/features/editor/CodeMirrorHost.tsx",
  "src/features/editor/CodeEditor.tsx",
  "src/features/editor/editor.css",
  "src/features/editor/documents.ts",
  "src/features/diff/find/diff-find.ts",
  "src/lib/file-tree.ts",
  "src/lib/mod-key.ts",
  "electron/projects/project-files.ts",
  "electron/projects/projects.ts",
  "README.md",
  "package.json",
  "docs/editor-notes.md",
];
const index = new PathIndex(paths);
const top = (q: string, n = 3) => index.rank(q, n).map((m) => m.path);

describe("PathIndex.rank", () => {
  it("matches camel humps: pfv is ProjectFileViewer", () => {
    expect(top("pfv", 1)).toEqual(["src/features/files/ProjectFileViewer.tsx"]);
  });

  it("follows a path with slashes: edi/cm is the editor's CodeMirror file", () => {
    expect(top("edi/cm", 1)).toEqual([
      "src/features/editor/CodeMirrorHost.tsx",
    ]);
  });

  it("prefers the file name over a folder name", () => {
    // docs/editor-notes.md and the editor folder both contain "editor".
    expect(top("editor.css", 1)).toEqual(["src/features/editor/editor.css"]);
    expect(top("readme", 1)).toEqual(["README.md"]);
  });

  it("ranks an exact name before longer ones", () => {
    expect(top("projects", 2)).toEqual([
      "electron/projects/projects.ts",
      "src/features/files/ProjectFiles.tsx",
    ]);
  });

  it("puts a run of adjacent letters above scattered ones", () => {
    expect(top("modkey", 1)).toEqual(["src/lib/mod-key.ts"]);
    expect(top("tree", 1)).toEqual(["src/lib/file-tree.ts"]);
  });

  it("finds nothing when the letters are not all there in order", () => {
    expect(top("zzz")).toEqual([]);
    expect(top("xtp")).toEqual([]);
    expect(top("")).toEqual([]);
  });

  it("drops letters scattered through the middles of words", () => {
    // t-r-e-e exists in order in CodeEditor.tsx's path, but only as noise.
    expect(top("tree")).toEqual(["src/lib/file-tree.ts"]);
    expect(index.rank("ed", 20).map((m) => m.path)).not.toContain("README.md");
  });

  it("ignores case, spaces and backslashes in the query", () => {
    expect(top("PROJECT FILE", 1)).toEqual(top("projectfile", 1));
    expect(top("electron\\proj", 1)[0]).toBe("electron/projects/projects.ts");
  });

  it("gives the positions to highlight", () => {
    const [hit] = index.rank("pfv", 1);
    const name = hit.path.indexOf("ProjectFileViewer");
    expect(hit.indices).toEqual([name, name + 7, name + 11]);
    expect(hit.indices.map((i) => hit.path[i]).join("")).toBe("PFV");
  });

  it("is quick on 50,000 paths", () => {
    const words = ["alpha", "beta", "Gamma", "delta", "view", "model", "util"];
    const many = Array.from({ length: 50_000 }, (_, i) => {
      const w = (n: number) => words[(i * n + (i >> 3)) % words.length];
      return `src/${w(3)}/${w(5)}${i % 97}/${w(7)}${w(2)}-${i}.ts`;
    });
    const big = new PathIndex(many);
    const started = performance.now();
    for (const q of ["a", "gmv", "src/vi/ut", "alphabetamodel", "zq"])
      big.rank(q, 100);
    const each = (performance.now() - started) / 5;
    // A generous bound: keystrokes should rank well under a frame or two.
    expect(each).toBeLessThan(250);
  });
});

describe("parseFileQuery", () => {
  it("reads a line and a column after the name", () => {
    expect(parseFileQuery("App.tsx:42")).toEqual({ text: "App.tsx", line: 42 });
    expect(parseFileQuery("App.tsx:42:7")).toEqual({
      text: "App.tsx",
      line: 42,
      column: 6,
    });
  });

  it("takes a bare line for the open file, and a dangling colon as nothing", () => {
    expect(parseFileQuery(":10")).toEqual({ text: "", line: 10 });
    expect(parseFileQuery("App:")).toEqual({ text: "App" });
  });

  it("leaves a name with no colon alone, spaces dropped", () => {
    expect(parseFileQuery(" edi/ cm ")).toEqual({ text: "edi/cm" });
  });
});
