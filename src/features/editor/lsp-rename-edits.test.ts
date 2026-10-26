// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { LspFileEdits } from "../../../shared/language-servers";
import { api } from "../../lib/api";
import type { FileDocument } from "./documents";
import { applyRename } from "./lsp-rename-edits";

vi.mock("../../lib/api", () => ({
  api: { projectFile: vi.fn(), saveProjectFile: vi.fn() },
}));

/** The project's closed files on disk. */
let disk: Map<string, string>;

beforeEach(() => {
  disk = new Map([
    ["b.ts", "import { a } from './a';"],
    ["c.ts", "a();"],
  ]);
  vi.mocked(api.projectFile).mockImplementation(async (_where, path) => {
    const contents = disk.get(path)!;
    return { contents, version: contents, head: "h" } as Awaited<
      ReturnType<typeof api.projectFile>
    >;
  });
  vi.mocked(api.saveProjectFile).mockImplementation(
    async (_where, path, _head, _version, contents) => {
      disk.set(path, contents);
      return { version: contents } as Awaited<
        ReturnType<typeof api.saveProjectFile>
      >;
    },
  );
});

const doc = {
  source: { kind: "project", where: "w" },
  path: "a.ts",
} as FileDocument;

const renameA = (path: string, character: number): LspFileEdits => ({
  path,
  edits: [
    {
      line: 0,
      character,
      endLine: 0,
      endCharacter: character + 1,
      newText: "b",
    },
  ],
});

const files = [renameA("a.ts", 7), renameA("b.ts", 9), renameA("c.ts", 0)];
const asked = (view: EditorView) => new Map([["a.ts", view.state.doc]]);

it("renames in the open buffer and the closed files", async () => {
  const view = new EditorView({ doc: "export a = 1;" });
  await applyRename(doc, "w", view, files, asked(view));
  expect(view.state.sliceDoc()).toBe("export b = 1;");
  expect(disk.get("b.ts")).toBe("import { b } from './a';");
  expect(disk.get("c.ts")).toBe("b();");
});

it("puts back the files already written when a later write fails", async () => {
  const view = new EditorView({ doc: "export a = 1;" });
  const save = vi.mocked(api.saveProjectFile).getMockImplementation()!;
  vi.mocked(api.saveProjectFile).mockImplementation(async (...args) => {
    if (args[1] === "c.ts") throw new Error("disk full");
    return save(...args);
  });
  await expect(applyRename(doc, "w", view, files, asked(view))).rejects.toThrow(
    "disk full",
  );
  expect(disk.get("b.ts")).toBe("import { a } from './a';");
  expect(view.state.sliceDoc()).toBe("export a = 1;");
});

it("renames nothing when an open buffer changed while the server worked", async () => {
  const view = new EditorView({ doc: "export a = 1;" });
  const before = new Map([["a.ts", Text.of(["// x", "export a = 1;"])]]);
  await expect(applyRename(doc, "w", view, files, before)).rejects.toThrow(
    "changed meanwhile",
  );
  expect(disk.get("b.ts")).toBe("import { a } from './a';");
  expect(disk.get("c.ts")).toBe("a();");
  expect(view.state.sliceDoc()).toBe("export a = 1;");
});
