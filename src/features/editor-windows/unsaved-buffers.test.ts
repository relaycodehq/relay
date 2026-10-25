// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { documents } from "../editor/documents";

const mocks = vi.hoisted(() => ({
  read: vi.fn(async (_where: string, path: string) => ({
    path,
    branch: "main",
    head: "abc",
    contents: `disk ${path}\n`,
    original: `disk ${path}\n`,
    version: "v1",
  })),
}));
vi.mock("../../lib/api", () => ({
  api: {
    projectFile: mocks.read,
    localHistoryRecord: vi.fn(async () => {}),
  },
}));
vi.mock("../files/OutsideFile", () => ({
  outsideSource: (path: string) => {
    const at = path.lastIndexOf("/");
    return {
      source: { kind: "project", where: path.slice(0, at), plain: true },
      name: path.slice(at + 1),
    };
  },
}));
import {
  adoptBuffers,
  collectUnsaved,
  discardWorkspace,
} from "./unsaved-buffers";

const where = "w";
const source = { kind: "project" as const, where, plain: false };

beforeEach(() => {
  localStorage.setItem(
    "relay-editor-tabs:" + where,
    JSON.stringify({
      tabs: [
        { path: "a.ts" },
        { path: "b.ts" },
        { path: "/tmp/n.txt", outside: true },
      ],
      active: "a.ts",
      recent: ["a.ts"],
    }),
  );
});
afterEach(() => {
  for (const doc of documents.unsaved())
    documents.close(doc.source, doc.path, true);
  documents.close(source, "a.ts", true);
  documents.close(source, "b.ts", true);
  localStorage.clear();
});

it("carries the unsaved text of the workspace's tabs, and only theirs, into a new window as edits", async () => {
  await adoptBuffers(where, [
    { path: "a.ts", text: "edited a\n" },
    { path: "/tmp/n.txt", outside: true, text: "edited note\n" },
  ]);
  const a = documents.find(source, "a.ts")!;
  expect(a.status.dirty).toBe(true);
  expect(a.text()).toBe("edited a\n");
  // Untouched tabs aren't opened by it.
  expect(documents.find(source, "b.ts")).toBeUndefined();
  expect(collectUnsaved(where)).toEqual([
    { path: "a.ts", text: "edited a\n" },
    { path: "/tmp/n.txt", outside: true, text: "edited note\n" },
  ]);
});

it("leaves typing that began before the handoff arrived alone", async () => {
  await adoptBuffers(where, [{ path: "a.ts", text: "first\n" }]);
  await adoptBuffers(where, [{ path: "a.ts", text: "second\n" }]);
  expect(documents.find(source, "a.ts")!.text()).toBe("first\n");
});

it("lets go of every document of the workspace, edited or not, once another window has them", async () => {
  await adoptBuffers(where, [{ path: "a.ts", text: "edited\n" }]);
  documents.get(source, "b.ts", () => []);
  discardWorkspace(where);
  expect(documents.find(source, "a.ts")).toBeUndefined();
  expect(collectUnsaved(where)).toEqual([]);
});
